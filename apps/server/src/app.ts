import { readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { checkRegistries, generate } from "@redwood/generator";
import { planApp } from "@redwood/planner";
import { LlmUnavailable, nextSuggestion, type LlmClient } from "@redwood/suggest";
import { checkSpec } from "@redwood/spec";
import { AuthError, login, logout, signup, userForToken, type User } from "./auth";
import type { Db } from "./db";
import type { Hub } from "./hub";
import { allowed, roleOn, type Action, type ProjectRole } from "./perms";
import type { PreviewStatus } from "./preview";
import {
  ConflictError, StoreError, applyBatch, blankSpec, createProject, head, history, nameVersion, restore, revision,
} from "./store";

/** The slice of PreviewManager the API needs, so tests can swap in a fake. */
export interface PreviewLike {
  start(projectId: string, spec: ReturnType<typeof blankSpec>): Promise<PreviewStatus>;
  status(projectId: string): PreviewStatus;
  stop(projectId: string): void;
  schedule(projectId: string, spec: ReturnType<typeof blankSpec>): void;
  confirmDestructive(projectId: string): Promise<void>;
}

type Env = { Variables: { user: User } };

const EXAMPLE = () =>
  JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8")) as unknown;

/** Failed logins per username, so a password can't be guessed at machine speed. */
class Throttle {
  private fails = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 15 * 60_000) {}
  blocked(key: string): boolean {
    const recent = (this.fails.get(key) ?? []).filter((t) => Date.now() - t < this.windowMs);
    this.fails.set(key, recent);
    return recent.length >= this.max;
  }
  fail(key: string): void {
    this.fails.set(key, [...(this.fails.get(key) ?? []), Date.now()]);
  }
  clear(key: string): void {
    this.fails.delete(key);
  }
}

export function createApp(deps: { db: Db; hub: Hub; preview: PreviewLike; llm?: LlmClient | null }): Hono<Env> {
  const { db, hub, preview } = deps;
  const llm = deps.llm ?? null;
  const app = new Hono<Env>();
  const throttle = new Throttle();

  app.onError((e, c) => {
    if (e instanceof ConflictError) return c.json({ error: e.message, items: e.items, headRevision: e.headRev }, 409);
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status);
    if (e instanceof AuthError) return c.json({ error: e.message }, 400);
    console.error(e);
    return c.json({ error: "internal error" }, 500);
  });

  // Writes must be JSON: a plain HTML form on another site cannot send that, which closes the CSRF door
  // that the SameSite cookie leaves ajar.
  app.use("/api/*", async (c, next) => {
    const m = c.req.method;
    if ((m === "POST" || m === "PUT" || m === "PATCH") && c.req.header("content-length") !== "0") {
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "send application/json" }, 415);
    }
    await next();
  });

  const body = async <T extends object>(c: Context): Promise<Partial<T>> =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as Partial<T>;

  // ---- accounts
  const startSession = (c: Context, token: string) =>
    setCookie(c, "rw_sid", token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 3600 });

  app.post("/api/auth/signup", async (c) => {
    const b = await body<{ username: string; password: string }>(c);
    const user = signup(db, String(b.username ?? ""), String(b.password ?? ""));
    const session = login(db, user.username, String(b.password))!;
    startSession(c, session.token);
    return c.json(user, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const b = await body<{ username: string; password: string }>(c);
    const key = String(b.username ?? "").trim().toLowerCase();
    if (throttle.blocked(key)) return c.json({ error: "too many attempts; try again later" }, 429);
    const session = login(db, key, String(b.password ?? ""));
    if (!session) {
      throttle.fail(key);
      return c.json({ error: "invalid credentials" }, 401);
    }
    throttle.clear(key);
    startSession(c, session.token);
    return c.json(session.user);
  });

  app.post("/api/auth/logout", (c) => {
    logout(db, getCookie(c, "rw_sid"));
    deleteCookie(c, "rw_sid", { path: "/" });
    return c.body(null, 204);
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/login") || c.req.path.startsWith("/api/auth/signup") || c.req.path.startsWith("/api/auth/logout")) {
      return next();
    }
    const user = userForToken(db, getCookie(c, "rw_sid"));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/api/auth/me", (c) => c.json(c.get("user")));

  app.get("/api/orgs", (c) => {
    const rows = db
      .prepare(`SELECT o.id, o.name, m.role FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = ? ORDER BY o.name`)
      .all(c.get("user").id);
    return c.json(rows);
  });

  // ---- projects
  app.get("/api/projects", (c) => {
    const uid = c.get("user").id;
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.org_id AS orgId,
                COALESCE(pm.role, 'owner') AS role,
                (SELECT MAX(rev) FROM revisions r WHERE r.project_id = p.id) AS rev,
                (SELECT MAX(created_at) FROM revisions r WHERE r.project_id = p.id) AS updatedAt
         FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
         WHERE pm.user_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM org_members om WHERE om.org_id = p.org_id AND om.user_id = ? AND om.role = 'admin')
         ORDER BY updatedAt DESC`,
      )
      .all(uid, uid);
    return c.json(rows);
  });

  app.post("/api/projects", async (c) => {
    const user = c.get("user");
    const b = await body<{ name: string; orgId: string; template: string }>(c);
    const name = String(b.name ?? "").trim();
    if (!name || name.length > 80) throw new StoreError("name must be 1-80 characters");
    const org = b.orgId
      ? (db.prepare(`SELECT org_id AS id FROM org_members WHERE org_id = ? AND user_id = ?`).get(b.orgId, user.id) as { id: string } | undefined)
      : (db.prepare(`SELECT org_id AS id FROM org_members WHERE user_id = ? AND role = 'admin' ORDER BY rowid LIMIT 1`).get(user.id) as { id: string } | undefined);
    if (!org) throw new StoreError("you are not a member of that organisation", 404);
    let spec = blankSpec(name);
    if (b.template === "example") {
      const parsed = checkSpec({ ...(EXAMPLE() as object), title: name });
      if (!parsed.spec) throw new StoreError("example spec is invalid", 422);
      spec = parsed.spec;
    }
    const id = createProject(db, { orgId: org.id, name, spec, userId: user.id });
    return c.json({ id, name, rev: 1 }, 201);
  });

  /** Loads the project's role for the caller and enforces the action, or answers 404 (invisible) / 403. */
  const guard = (c: Context<Env>, action: Action): { id: string; role: ProjectRole } | Response => {
    const id = c.req.param("id") ?? "";
    const role = roleOn(db, c.get("user").id, id);
    if (!role) return c.json({ error: "not found" }, 404);
    if (!allowed(role, action)) return c.json({ error: "forbidden" }, 403);
    return { id, role };
  };
  const isResponse = (x: unknown): x is Response => x instanceof Response;

  app.get("/api/projects/:id", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    const { rev, spec } = head(db, g.id);
    const p = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(g.id) as { name: string };
    return c.json({ id: g.id, name: p.name, role: g.role, rev, spec });
  });

  app.patch("/api/projects/:id", async (c) => {
    const g = guard(c, "manage");
    if (isResponse(g)) return g;
    const name = String((await body<{ name: string }>(c)).name ?? "").trim();
    if (!name || name.length > 80) throw new StoreError("name must be 1-80 characters");
    db.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run(name, g.id);
    return c.json({ id: g.id, name });
  });

  app.delete("/api/projects/:id", (c) => {
    const g = guard(c, "manage");
    if (isResponse(g)) return g;
    preview.stop(g.id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(g.id);
    return c.body(null, 204);
  });

  // ---- members
  app.get("/api/projects/:id/members", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    return c.json(
      db.prepare(`SELECT u.username, pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.username`).all(g.id),
    );
  });

  app.put("/api/projects/:id/members", async (c) => {
    const g = guard(c, "manage");
    if (isResponse(g)) return g;
    const b = await body<{ username: string; role: ProjectRole }>(c);
    if (!["owner", "editor", "reviewer", "viewer"].includes(String(b.role))) throw new StoreError("role must be owner, editor, reviewer or viewer");
    const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(String(b.username ?? "").toLowerCase()) as { id: string } | undefined;
    if (!u) throw new StoreError("no such user", 404);
    const current = db.prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`).get(g.id, u.id) as { role: string } | undefined;
    if (current?.role === "owner" && b.role !== "owner") ensureAnotherOwner(g.id, u.id);
    db.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
                ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`).run(g.id, u.id, String(b.role));
    return c.json({ username: b.username, role: b.role });
  });

  app.delete("/api/projects/:id/members/:username", (c) => {
    const g = guard(c, "manage");
    if (isResponse(g)) return g;
    const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(c.req.param("username")) as { id: string } | undefined;
    if (!u) throw new StoreError("no such user", 404);
    ensureAnotherOwner(g.id, u.id);
    db.prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`).run(g.id, u.id);
    return c.body(null, 204);
  });

  /** A project must never be left with nobody able to manage it. */
  function ensureAnotherOwner(projectId: string, leavingUserId: string): void {
    const others = db
      .prepare(`SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner' AND user_id != ?`)
      .get(projectId, leavingUserId) as { n: number };
    if (!others.n) throw new StoreError("a project needs at least one owner");
  }

  // ---- the spec: commands, history, versions
  const published = (id: string, rev: number, author: string, commands: unknown[], spec: ReturnType<typeof blankSpec>, restored?: number) => {
    hub.broadcast(id, { type: "revision", rev, author, commands, ...(restored ? { restored } : {}) });
    preview.schedule(id, spec);
  };

  app.post("/api/projects/:id/commands", async (c) => {
    const g = guard(c, "edit");
    if (isResponse(g)) return g;
    const b = await body<{ baseRevision: number; commands: unknown[] }>(c);
    if (!Number.isInteger(b.baseRevision) || !Array.isArray(b.commands)) throw new StoreError("send { baseRevision, commands[] }");
    const user = c.get("user");
    const r = applyBatch(db, g.id, b.baseRevision as number, b.commands, user.id);
    published(g.id, r.rev, user.username, b.commands, r.spec);
    return c.json(r);
  });

  app.get("/api/projects/:id/history", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    return c.json(history(db, g.id));
  });

  app.get("/api/projects/:id/revisions/:rev", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    return c.json(revision(db, g.id, Number(c.req.param("rev"))));
  });

  app.put("/api/projects/:id/revisions/:rev/label", async (c) => {
    const g = guard(c, "edit");
    if (isResponse(g)) return g;
    const label = (await body<{ label: string | null }>(c)).label;
    nameVersion(db, g.id, Number(c.req.param("rev")), label === null || label === undefined ? null : String(label));
    return c.json({ rev: Number(c.req.param("rev")), label: label ?? null });
  });

  app.post("/api/projects/:id/restore", async (c) => {
    const g = guard(c, "edit");
    if (isResponse(g)) return g;
    const from = Number((await body<{ rev: number }>(c)).rev);
    const user = c.get("user");
    const r = restore(db, g.id, from, user.id);
    published(g.id, r.rev, user.username, [{ type: "restore", from }], r.spec, from);
    return c.json(r);
  });

  // ---- reports
  app.get("/api/projects/:id/check", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    const spec = head(db, g.id).spec;
    return c.json([...checkSpec(spec).issues, ...checkRegistries(spec)]);
  });

  app.get("/api/projects/:id/plan", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    return c.json(planApp(head(db, g.id).spec));
  });

  app.get("/api/projects/:id/manifest", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    const { manifest } = generate(head(db, g.id).spec);
    return c.json(manifest);
  });

  // ---- suggestions: the next open question, never applied until a person accepts it
  app.get("/api/ai", (c) => c.json({ enabled: !!llm, model: llm?.model ?? null }));

  const asking = new Set<string>();
  app.get("/api/projects/:id/suggestion", async (c) => {
    const g = guard(c, "edit");
    if (isResponse(g)) return g;
    // Two questions at once for one project would race to settle the same thing; one at a time.
    if (asking.has(g.id)) return c.json({ error: "already working out the next suggestion" }, 409);
    asking.add(g.id);
    try {
      const { rev, spec } = head(db, g.id);
      const decided = new Set((db.prepare(`SELECT key FROM decided_suggestions WHERE project_id = ?`).all(g.id) as { key: string }[]).map((r) => r.key));
      const settle = db.prepare(`INSERT OR IGNORE INTO decided_suggestions (project_id, key) VALUES (?, ?)`);
      const suggestion = await nextSuggestion(spec, { llm, decided, decide: (key) => void settle.run(g.id, key) });
      return c.json({ rev, suggestion });
    } catch (e) {
      if (e instanceof LlmUnavailable) return c.json({ error: e.message }, 503);
      throw e;
    } finally {
      asking.delete(g.id);
    }
  });

  app.post("/api/projects/:id/suggestion/skip", async (c) => {
    const g = guard(c, "edit");
    if (isResponse(g)) return g;
    const key = String((await body<{ key: string }>(c)).key ?? "");
    if (!key || key.length > 200) throw new StoreError("send { key }");
    db.prepare(`INSERT OR IGNORE INTO decided_suggestions (project_id, key) VALUES (?, ?)`).run(g.id, key);
    return c.body(null, 204);
  });

  // ---- preview
  app.get("/api/projects/:id/preview", (c) => {
    const g = guard(c, "read");
    if (isResponse(g)) return g;
    return c.json(preview.status(g.id));
  });

  app.post("/api/projects/:id/preview/start", async (c) => {
    const g = guard(c, "preview");
    if (isResponse(g)) return g;
    return c.json(await preview.start(g.id, head(db, g.id).spec), 202);
  });

  app.post("/api/projects/:id/preview/stop", (c) => {
    const g = guard(c, "preview");
    if (isResponse(g)) return g;
    preview.stop(g.id);
    return c.body(null, 204);
  });

  // Applying a data-losing migration to the preview database is a deliberate act, never a side effect of editing.
  app.post("/api/projects/:id/preview/confirm-destructive", async (c) => {
    const g = guard(c, "preview");
    if (isResponse(g)) return g;
    await preview.confirmDestructive(g.id);
    return c.json(preview.status(g.id));
  });

  return app;
}
