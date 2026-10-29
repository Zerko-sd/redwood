import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { DestructiveMigrationError, generate, writeApp } from "@redwood/generator";
import type { Spec } from "@redwood/spec";
import { blankSpec } from "./store";

export type PreviewState = "stopped" | "starting" | "running" | "error";

export interface PreviewStatus {
  state: PreviewState;
  webUrl?: string;
  apiUrl?: string;
  /** Demo accounts the generated app seeds: username = role, password "redwood". */
  accounts: string[];
  error?: string;
  /** Data-losing steps waiting for a person's confirmation. The running app is left as it was. */
  pendingDestructive?: string[];
  logs: string[];
}

interface Running {
  dir: string;
  apiPort: number;
  webPort: number;
  api?: ChildProcess;
  web?: ChildProcess;
  state: PreviewState;
  error?: string;
  pending?: string[];
  logs: string[];
  latest: Spec;
  queue: Promise<void>;
  timer?: NodeJS.Timeout;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

async function waitFor(url: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1500) }); // any HTTP answer means the server is up
      return;
    } catch {
      if (Date.now() > until) throw new Error(`${url} did not come up within ${ms / 1000}s`);
      await sleep(250);
    }
  }
}

/** Preview apps run user-described code, so they never inherit this process's keys and tokens. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|NEBIUS/i.test(k)) env[k] = v;
  return { ...env, ...extra };
}

function kill(child?: ChildProcess): void {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else child.kill("SIGTERM");
}

/** Server-side files: changing any of them needs the API process restarted; web files hot-reload on their own. */
const needsApiRestart = (path: string) =>
  path.startsWith("src/server/") || path.startsWith("src/shared/") || path.startsWith("migrations/") || path === "package.json";

export class PreviewManager {
  private apps = new Map<string, Running>();
  private deps?: Promise<string>;

  constructor(private opts: { root: string; onChange?: (projectId: string, s: PreviewStatus) => void }) {}

  /** One shared install for all previews: the generated apps always use the same dependencies. */
  private ensureDeps(): Promise<string> {
    this.deps ??= (async () => {
      const dir = resolve(this.opts.root, "_deps");
      mkdirSync(dir, { recursive: true });
      // Reinstall whenever the generated app's dependencies change (a new kit, a new font), not only the first time.
      const wanted = generate(blankSpec("deps")).files["package.json"]!;
      const have = existsSync(join(dir, "package.json")) ? readFileSync(join(dir, "package.json"), "utf8") : "";
      if (!existsSync(join(dir, "node_modules", "vite")) || have !== wanted) {
        writeFileSync(join(dir, "package.json"), wanted);
        await new Promise<void>((ok, fail) => {
          const p = spawn("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, shell: true, stdio: "ignore" });
          p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`npm install failed (${code})`))));
        });
      }
      return join(dir, "node_modules");
    })().catch((e) => {
      this.deps = undefined; // let the next start try again
      throw e;
    });
    return this.deps;
  }

  status(projectId: string): PreviewStatus {
    const a = this.apps.get(projectId);
    if (!a) return { state: "stopped", accounts: [], logs: [] };
    return {
      state: a.state,
      ...(a.state === "running" ? { webUrl: `http://127.0.0.1:${a.webPort}`, apiUrl: `http://127.0.0.1:${a.apiPort}` } : {}),
      accounts: a.latest.roles.map((r) => r.id.replace(/^role:/, "")),
      ...(a.error ? { error: a.error } : {}),
      ...(a.pending ? { pendingDestructive: a.pending } : {}),
      logs: a.logs.slice(-40),
    };
  }

  private emit(projectId: string): void {
    this.opts.onChange?.(projectId, this.status(projectId));
  }

  private run(projectId: string, a: Running, task: () => Promise<void>): Promise<void> {
    a.queue = a.queue.then(task).catch((e: Error) => {
      a.state = "error";
      a.error = e.message;
      this.emit(projectId);
    });
    return a.queue;
  }

  private spawnLogged(a: Running, args: string[], env: Record<string, string>): ChildProcess {
    const p = spawn(process.execPath, args, { cwd: a.dir, env: childEnv(env), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const keep = (buf: Buffer) => {
      a.logs.push(...buf.toString().split(/\r?\n/).filter(Boolean));
      if (a.logs.length > 200) a.logs.splice(0, a.logs.length - 200);
    };
    p.stdout?.on("data", keep);
    p.stderr?.on("data", keep);
    return p;
  }

  private async startApi(a: Running, modules: string): Promise<void> {
    kill(a.api);
    a.api = this.spawnLogged(a, [join(modules, "tsx", "dist", "cli.mjs"), "src/server/main.ts"], {
      PORT: String(a.apiPort),
      HOST: "127.0.0.1",
      DB_PATH: join(a.dir, "app.db"),
      SEED_DEMO: "1",
    });
    const api = a.api;
    api.on("exit", (code) => {
      if (a.api === api && a.state === "running") {
        a.state = "error";
        a.error = `the preview API stopped (exit ${code}); see logs`;
      }
    });
    await waitFor(`http://127.0.0.1:${a.apiPort}/api/me`);
  }

  /** Generates into the workspace. Returns false if data-losing steps are waiting for confirmation. */
  private sync(a: Running, spec: Spec, allowDestructive: boolean): { ok: boolean; restartApi: boolean } {
    try {
      const r = writeApp(a.dir, spec, { force: true, allowDestructive }); // the workspace is machine-owned
      a.pending = undefined;
      return { ok: true, restartApi: [...r.written, ...r.removed].some(needsApiRestart) };
    } catch (e) {
      if (e instanceof DestructiveMigrationError) {
        a.pending = e.steps;
        return { ok: false, restartApi: false };
      }
      throw e;
    }
  }

  async start(projectId: string, spec: Spec): Promise<PreviewStatus> {
    const existing = this.apps.get(projectId);
    if (existing && existing.state !== "stopped" && existing.state !== "error") return this.status(projectId);
    if (existing) this.stop(projectId);

    const a: Running = {
      dir: resolve(this.opts.root, projectId),
      apiPort: await freePort(),
      webPort: await freePort(),
      state: "starting",
      logs: [],
      latest: spec,
      queue: Promise.resolve(),
    };
    this.apps.set(projectId, a);
    this.emit(projectId);

    void this.run(projectId, a, async () => {
      const modules = await this.ensureDeps();
      mkdirSync(a.dir, { recursive: true });
      const first = this.sync(a, spec, false);
      if (!first.ok) throw new Error(`cannot start: ${a.pending?.join("; ")}`);
      if (!existsSync(join(a.dir, "node_modules"))) symlinkSync(modules, join(a.dir, "node_modules"), "junction");
      await this.startApi(a, modules);
      a.web = this.spawnLogged(a, [join(modules, "vite", "bin", "vite.js"), "--port", String(a.webPort), "--strictPort", "--host", "127.0.0.1"], {
        API_PORT: String(a.apiPort),
      });
      await waitFor(`http://127.0.0.1:${a.webPort}/`);
      a.state = "running";
      a.error = undefined;
      this.emit(projectId);
    });
    return this.status(projectId);
  }

  /** Called after every committed revision. Bursts of edits collapse into one regeneration. */
  schedule(projectId: string, spec: Spec): void {
    const a = this.apps.get(projectId);
    if (!a || a.state === "stopped") return;
    a.latest = spec;
    clearTimeout(a.timer);
    a.timer = setTimeout(() => void this.regenerate(projectId, false), 250);
  }

  /** Applies a held-back data-losing migration after a person has confirmed it. */
  confirmDestructive(projectId: string): Promise<void> {
    return this.regenerate(projectId, true);
  }

  private regenerate(projectId: string, allowDestructive: boolean): Promise<void> {
    const a = this.apps.get(projectId);
    if (!a) return Promise.resolve();
    return this.run(projectId, a, async () => {
      const wasError = a.state === "error";
      const { ok, restartApi } = this.sync(a, a.latest, allowDestructive);
      if (!ok) return this.emit(projectId); // keep the old app running; the status carries the pending steps
      if (restartApi || wasError) await this.startApi(a, await this.ensureDeps());
      if (a.state !== "starting") {
        a.state = "running";
        a.error = undefined;
      }
      this.emit(projectId);
    });
  }

  stop(projectId: string): void {
    const a = this.apps.get(projectId);
    if (!a) return;
    clearTimeout(a.timer);
    kill(a.web);
    kill(a.api);
    a.api = a.web = undefined;
    a.state = "stopped";
    this.apps.delete(projectId);
    this.opts.onChange?.(projectId, { state: "stopped", accounts: [], logs: [] });
  }

  stopAll(): void {
    for (const id of [...this.apps.keys()]) this.stop(id);
  }
}
