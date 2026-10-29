import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DestructiveMigrationError, RegenerationRefused, checkRegistries, findEdited, writeApp } from "@redwood/generator";
import { planApp } from "@redwood/planner";
import { canonicalJson, checkSpec, type Spec } from "@redwood/spec";

export interface Io {
  out(line: string): void;
  err(line: string): void;
  cwd: string;
}

const consoleIo: Io = { out: console.log, err: console.error, cwd: process.cwd() };

const HELP = `redwood: turn user stories into a working app

Usage
  redwood init <name> [--example] [-o file]   write a starter spec (blank, or the Bus Fleet example)
  redwood check <spec>                         validate a spec and list problems
  redwood plan <spec>                          show what each screen will become, and why
  redwood generate <spec> -o <dir>             generate the app (re-running only replaces what it wrote)
        [--force]                              overwrite generated files that were edited by hand
        [--allow-destructive]                  accept migrations that drop columns or tables
  redwood verify <dir>                         report generated files that were edited by hand

Specs are JSON files. Exit code is 0 on success, 1 on a problem with the spec or the output, 2 on bad usage.`;

interface Args {
  positional: string[];
  out?: string;
  force: boolean;
  allowDestructive: boolean;
  example: boolean;
  help: boolean;
}

function parse(argv: string[]): Args | string {
  const a: Args = { positional: [], force: false, allowDestructive: false, example: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === "-o" || t === "--out") {
      const v = argv[++i];
      if (!v) return `${t} needs a value`;
      a.out = v;
    } else if (t === "--force") a.force = true;
    else if (t === "--allow-destructive") a.allowDestructive = true;
    else if (t === "--example") a.example = true;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (t.startsWith("-")) return `unknown option ${t}`;
    else a.positional.push(t);
  }
  return a;
}

function loadSpec(io: Io, file: string | undefined): { spec: Spec; warnings: number } | number {
  if (!file) {
    io.err("missing <spec> file; see redwood --help");
    return 2;
  }
  const path = resolve(io.cwd, file);
  if (!existsSync(path)) {
    io.err(`no such file: ${file}`);
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    io.err(`${file} is not valid JSON: ${(e as Error).message}`);
    return 1;
  }
  const checked = checkSpec(raw);
  const spec = checked.spec;
  // The schema accepts any layout or theme name; the generator is what knows which ones exist.
  const issues = spec ? [...checked.issues, ...checkRegistries(spec)] : checked.issues;
  const errors = issues.filter((i) => i.severity === "error");
  for (const i of issues) (i.severity === "error" ? io.err : io.out)(`${i.severity === "error" ? "error  " : "warning"} ${i.path}: ${i.message}`);
  if (!spec || errors.length) {
    io.err(`${errors.length} error${errors.length === 1 ? "" : "s"} in ${file}`);
    return 1;
  }
  return { spec, warnings: issues.length };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";

function init(io: Io, a: Args): number {
  const name = a.positional[0];
  if (!name) {
    io.err("usage: redwood init <name> [--example] [-o file]");
    return 2;
  }
  const file = resolve(io.cwd, a.out ?? `${slug(name)}.spec.json`);
  if (existsSync(file)) {
    io.err(`${basename(file)} already exists; choose another name with -o`);
    return 1;
  }
  let raw: unknown = { schemaVersion: 1, title: name };
  if (a.example) {
    const example = JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8")) as object;
    raw = { ...example, title: name };
  }
  const { spec } = checkSpec(raw);
  writeFileSync(file, canonicalJson(spec));
  io.out(`wrote ${basename(file)}${a.example ? " (the Bus Fleet example)" : ""}`);
  io.out(`next: redwood check ${basename(file)}`);
  return 0;
}

function plan(io: Io, a: Args): number {
  const loaded = loadSpec(io, a.positional[0]);
  if (typeof loaded === "number") return loaded;
  for (const p of planApp(loaded.spec)) {
    io.out(`${p.screen}  ${p.path}${p.entity ? `  (${p.entity})` : ""}  layout: ${p.layout} (${p.layoutWhy})`);
    for (const i of p.items) {
      const gate = i.requires ? ` [needs ${i.requires}]` : "";
      const cites = i.because.length ? `  <- ${i.because.join(", ")}` : "";
      io.out(`  ${i.slot.padEnd(8)} ${i.part}${gate}: ${i.why}${cites}`);
    }
    for (const d of p.dropped) io.out(`  dropped  ${d.part}: ${d.why}`);
    for (const x of p.placeholders) io.out(`  GAP      ${x.what}: ${x.why}`);
  }
  return 0;
}

function generateCmd(io: Io, a: Args): number {
  if (!a.out) {
    io.err("generate needs -o <dir>");
    return 2;
  }
  const loaded = loadSpec(io, a.positional[0]);
  if (typeof loaded === "number") return loaded;
  const dir = resolve(io.cwd, a.out);
  try {
    const r = writeApp(dir, loaded.spec, { force: a.force, allowDestructive: a.allowDestructive });
    io.out(`generated ${basename(dir)}: ${r.written.length} written, ${r.removed.length} removed, ${r.scaffolded.length} developer files created`);
    io.out(`tree ${r.manifest.treeHash.slice(0, 12)}  spec ${r.manifest.specHash.slice(0, 12)}`);
    for (const g of r.manifest.needsDeveloper) io.out(`needs a developer: ${g.what} (${g.why})`);
    if (!r.written.length && !r.removed.length) io.out("nothing changed");
    return 0;
  } catch (e) {
    if (e instanceof RegenerationRefused) {
      io.err(e.message);
      io.err("(--force overwrites them)");
      return 1;
    }
    if (e instanceof DestructiveMigrationError) {
      io.err(e.message);
      return 1;
    }
    throw e;
  }
}

function verify(io: Io, a: Args): number {
  const dir = a.positional[0];
  if (!dir) {
    io.err("usage: redwood verify <dir>");
    return 2;
  }
  const full = resolve(io.cwd, dir);
  if (!existsSync(resolve(full, "redwood.manifest.json"))) {
    io.err(`${dir} has no redwood.manifest.json; was it generated by redwood?`);
    return 1;
  }
  const edited = findEdited(full);
  if (!edited.length) {
    io.out("ok: no generated file has been edited by hand");
    return 0;
  }
  io.err("edited by hand:");
  for (const f of edited) io.err(`  ${f}`);
  return 1;
}

export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    io.out(HELP);
    return cmd ? 0 : 2;
  }
  const a = parse(rest);
  if (typeof a === "string") {
    io.err(a);
    return 2;
  }
  if (a.help) {
    io.out(HELP);
    return 0;
  }
  switch (cmd) {
    case "init": return init(io, a);
    case "check": {
      const r = loadSpec(io, a.positional[0]);
      if (typeof r === "number") return r;
      io.out(`ok: ${r.spec.title} (${r.warnings} warning${r.warnings === 1 ? "" : "s"})`);
      return 0;
    }
    case "plan": return plan(io, a);
    case "generate": return generateCmd(io, a);
    case "verify": return verify(io, a);
    default:
      io.err(`unknown command "${cmd}"; see redwood --help`);
      return 2;
  }
}
