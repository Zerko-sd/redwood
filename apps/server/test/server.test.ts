import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer, type PreviewLike, type Running } from "../src";

/** A fake preview that records what the API asked of it. */
function fakePreview() {
  const calls: string[] = [];
  const p: PreviewLike & { calls: string[] } = {
    calls,
    start: async (id) => (calls.push(`start:${id}`), { state: "starting", accounts: [], logs: [] }),
    status: () => ({ state: "stopped", accounts: [], logs: [] }),
    stop: (id) => void calls.push(`stop:${id}`),
    schedule: (id) => void calls.push(`schedule:${id}`),
    confirmDestructive: async (id) => void calls.push(`confirm:${id}`),
  };
  return p;
}

let srv: Running;
let preview: ReturnType<typeof fakePreview>;
const base = () => `http://127.0.0.1:${srv.port}`;

beforeEach(async () => {
  preview = fakePreview();
  srv = await startServer({ port: 0, dbPath: ":memory:", preview });
});
afterEach(() => srv.close());

/** A tiny cookie-keeping client. */
function client() {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base() + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined, cookie: () => cookie };
  };
  return {
    call,
    get: (p: string) => call("GET", p),
    post: (p: string, b: unknown = {}) => call("POST", p, b),
    put: (p: string, b: unknown = {}) => call("PUT", p, b),
    patch: (p: string, b: unknown = {}) => call("PATCH", p, b),
    del: (p: string) => call("DELETE", p),
    cookie: () => cookie,
  };
}

async function signedUp(name: string) {
  const c = client();
  const r = await c.post("/api/auth/signup", { username: name, password: "correct horse" });
  expect(r.status).toBe(201);
  return c;
}

const addRole = (id: string) => ({ type: "addRole", role: { id: `role:${id}`, name: id } });

describe("accounts", () => {
  it("signs up, signs in and out, and rejects bad credentials", async () => {
    const c = await signedUp("alice");
    expect((await c.get("/api/auth/me")).json.username).toBe("alice");
    await c.post("/api/auth/logout");
    expect((await c.get("/api/auth/me")).status).toBe(401);
    expect((await c.post("/api/auth/login", { username: "alice", password: "wrong" })).status).toBe(401);
    expect((await c.post("/api/auth/login", { username: "alice", password: "correct horse" })).status).toBe(200);
  });

  it("refuses weak passwords and duplicate usernames", async () => {
    const c = client();
    expect((await c.post("/api/auth/signup", { username: "bob", password: "short" })).status).toBe(400);
    await signedUp("bob");
    expect((await client().post("/api/auth/signup", { username: "bob", password: "another long one" })).status).toBe(400);
  });

  it("locks out repeated wrong passwords", async () => {
    await signedUp("carol");
    const c = client();
    for (let i = 0; i < 10; i++) await c.post("/api/auth/login", { username: "carol", password: "nope-nope" });
    expect((await c.post("/api/auth/login", { username: "carol", password: "correct horse" })).status).toBe(429);
  });

  it("requires JSON for writes", async () => {
    const res = await fetch(base() + "/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(res.status).toBe(415);
  });

  it("requires sign-in for everything else", async () => {
    expect((await client().get("/api/projects")).status).toBe(401);
  });
});

describe("projects and roles", () => {
  it("creates a project the creator owns, from blank or the example", async () => {
    const a = await signedUp("alice");
    const blank = await a.post("/api/projects", { name: "Empty" });
    expect(blank.status).toBe(201);
    const example = await a.post("/api/projects", { name: "Fleet", template: "example" });
    const got = await a.get(`/api/projects/${example.json.id}`);
    expect(got.json.role).toBe("owner");
    expect(got.json.spec.title).toBe("Fleet");
    expect(got.json.spec.entities.length).toBeGreaterThan(0);
    expect((await a.get("/api/projects")).json).toHaveLength(2);
  });

  it("hides a project from people who are not on it", async () => {
    const a = await signedUp("alice");
    const b = await signedUp("bob");
    const { id } = (await a.post("/api/projects", { name: "Secret" })).json;
    expect((await b.get(`/api/projects/${id}`)).status).toBe(404);
    expect((await b.get("/api/projects")).json).toEqual([]);
  });

  it("enforces what each role may do", async () => {
    const a = await signedUp("alice");
    const { id } = (await a.post("/api/projects", { name: "P" })).json;
    for (const [user, role] of [["eve", "editor"], ["rita", "reviewer"], ["vic", "viewer"]] as const) {
      await signedUp(user);
      expect((await a.put(`/api/projects/${id}/members`, { username: user, role })).status).toBe(200);
    }
    const as = async (name: string) => {
      const c = client();
      await c.post("/api/auth/login", { username: name, password: "correct horse" });
      return c;
    };
    const cmd = { baseRevision: 1, commands: [addRole("x")] };
    expect((await (await as("vic")).post(`/api/projects/${id}/commands`, cmd)).status).toBe(403);
    expect((await (await as("rita")).post(`/api/projects/${id}/commands`, cmd)).status).toBe(403);
    expect((await (await as("vic")).get(`/api/projects/${id}`)).status).toBe(200);
    expect((await (await as("eve")).post(`/api/projects/${id}/commands`, cmd)).status).toBe(200);
    expect((await (await as("eve")).put(`/api/projects/${id}/members`, { username: "vic", role: "owner" })).status).toBe(403);
    expect((await (await as("eve")).del(`/api/projects/${id}`)).status).toBe(403);
    expect((await (await as("vic")).post(`/api/projects/${id}/preview/start`)).status).toBe(403);
    expect((await (await as("eve")).post(`/api/projects/${id}/preview/start`)).status).toBe(202);
  });

  it("never leaves a project without an owner", async () => {
    const a = await signedUp("alice");
    const { id } = (await a.post("/api/projects", { name: "P" })).json;
    expect((await a.put(`/api/projects/${id}/members`, { username: "alice", role: "viewer" })).status).toBe(400);
    expect((await a.del(`/api/projects/${id}/members/alice`)).status).toBe(400);
  });
});

describe("commands and revisions", () => {
  async function project() {
    const a = await signedUp("alice");
    const { id } = (await a.post("/api/projects", { name: "P", template: "example" })).json;
    return { a, id };
  }

  it("applies a batch as one revision and returns the new spec", async () => {
    const { a, id } = await project();
    const r = await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [addRole("auditor"), addRole("clerk")] });
    expect(r.status).toBe(200);
    expect(r.json.rev).toBe(2);
    expect(r.json.spec.roles.map((x: { id: string }) => x.id)).toEqual(["role:admin", "role:driver", "role:auditor", "role:clerk"]);
    expect(preview.calls).toContain(`schedule:${id}`);
  });

  it("rejects a batch that breaks the spec, and applies none of it", async () => {
    const { a, id } = await project();
    const r = await a.post(`/api/projects/${id}/commands`, {
      baseRevision: 1,
      commands: [addRole("ok"), { type: "addStory", story: { id: "story:bad", role: "role:ghost", action: "x" } }],
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toContain("unknown role");
    const now = await a.get(`/api/projects/${id}`);
    expect(now.json.rev).toBe(1);
    expect(now.json.spec.roles.some((x: { id: string }) => x.id === "role:ok")).toBe(false);
  });

  it("rebases a stale edit that touches different items", async () => {
    const { a, id } = await project();
    await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [addRole("one")] });
    const r = await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [addRole("two")] });
    expect(r.status).toBe(200);
    expect(r.json.rebased).toBe(true);
    expect(r.json.rev).toBe(3);
    expect(r.json.spec.roles.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining(["role:one", "role:two"]));
  });

  it("reports a stale edit that touches the same item, instead of overwriting", async () => {
    const { a, id } = await project();
    const rename = (name: string) => ({ type: "updateField", entity: "entity:bus", id: "field:plate", patch: { name } });
    await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [rename("Plate Number")] });
    const r = await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [rename("Registration")] });
    expect(r.status).toBe(409);
    expect(r.json.items).toEqual(["field:plate"]);
    expect(r.json.headRevision).toBe(2);
    const field = (await a.get(`/api/projects/${id}`)).json.spec.entities[0].fields[0];
    expect(field.name).toBe("Plate Number");
  });

  it("keeps history, names versions, and restores without rewriting the past", async () => {
    const { a, id } = await project();
    await a.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [addRole("temp")] });
    expect((await a.put(`/api/projects/${id}/revisions/1/label`, { label: "Initial" })).status).toBe(200);
    expect((await a.put(`/api/projects/${id}/revisions/2/label`, { label: "Initial" })).status).toBe(400); // labels are unique
    const restored = await a.post(`/api/projects/${id}/restore`, { rev: 1 });
    expect(restored.json.rev).toBe(3);
    expect(restored.json.spec.roles.some((x: { id: string }) => x.id === "role:temp")).toBe(false);
    const h = (await a.get(`/api/projects/${id}/history`)).json;
    expect(h.map((e: { rev: number }) => e.rev)).toEqual([3, 2, 1]);
    expect(h[2].label).toBe("Initial");
    expect((await a.get(`/api/projects/${id}/revisions/2`)).json.spec.roles.some((x: { id: string }) => x.id === "role:temp")).toBe(true);
    // a stale edit made before the restore now conflicts with it
    const stale = await a.post(`/api/projects/${id}/commands`, { baseRevision: 2, commands: [addRole("late")] });
    expect(stale.status).toBe(409);
  });

  it("serves checks, plans and a manifest", async () => {
    const { a, id } = await project();
    expect(Array.isArray((await a.get(`/api/projects/${id}/check`)).json)).toBe(true);
    expect((await a.get(`/api/projects/${id}/plan`)).json.map((p: { screen: string }) => p.screen)).toEqual(["screen:buses", "screen:trips"]);
    expect((await a.get(`/api/projects/${id}/manifest`)).json.treeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stops the preview when a project is deleted", async () => {
    const { a, id } = await project();
    expect((await a.del(`/api/projects/${id}`)).status).toBe(204);
    expect(preview.calls).toContain(`stop:${id}`);
    expect((await a.get(`/api/projects/${id}`)).status).toBe(404);
  });
});

describe("live updates", () => {
  const open = (path: string, cookie: string) =>
    new Promise<{ ws: WebSocket; messages: any[]; opened: boolean }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}${path}`, { headers: { cookie } });
      const state = { ws, messages: [] as any[], opened: false };
      ws.on("message", (m) => state.messages.push(JSON.parse(String(m))));
      ws.on("open", () => ((state.opened = true), resolve(state)));
      ws.on("error", () => resolve(state));
      ws.on("unexpected-response", () => resolve(state));
    });
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fn()).toBe(true);
  };

  it("sends other collaborators' revisions and tracks who is here", async () => {
    const a = await signedUp("alice");
    const b = await signedUp("bob");
    const { id } = (await a.post("/api/projects", { name: "P" })).json;
    await a.put(`/api/projects/${id}/members`, { username: "bob", role: "editor" });

    const wa = await open(`/ws?project=${id}`, a.cookie());
    const wb = await open(`/ws?project=${id}`, b.cookie());
    expect(wa.messages[0]).toMatchObject({ type: "hello", rev: 1 });
    await until(() => wa.messages.some((m) => m.type === "presence" && m.presence.join() === "alice,bob"));

    expect((await b.post(`/api/projects/${id}/commands`, { baseRevision: 1, commands: [addRole("frombob")] })).status).toBe(200);
    await until(() => wa.messages.some((m) => m.type === "revision" && m.rev === 2 && m.author === "bob"));

    wb.ws.close();
    await until(() => wa.messages.some((m) => m.type === "presence" && m.presence.join() === "alice"));
    wa.ws.close();
  });

  it("refuses sockets for strangers and for people not on the project", async () => {
    const a = await signedUp("alice");
    const b = await signedUp("bob");
    const { id } = (await a.post("/api/projects", { name: "P" })).json;
    expect((await open(`/ws?project=${id}`, "")).opened).toBe(false);
    expect((await open(`/ws?project=${id}`, b.cookie())).opened).toBe(false);
    const ok = await open(`/ws?project=${id}`, a.cookie());
    expect(ok.opened).toBe(true);
    ok.ws.close();
  });

  it("cannot be used to change a project", async () => {
    const a = await signedUp("alice");
    const { id } = (await a.post("/api/projects", { name: "P" })).json;
    const w = await open(`/ws?project=${id}`, a.cookie());
    w.ws.send(JSON.stringify({ baseRevision: 1, commands: [addRole("sneaky")] }));
    await new Promise((r) => setTimeout(r, 100));
    expect((await a.get(`/api/projects/${id}`)).json.rev).toBe(1);
    w.ws.close();
  });
});
