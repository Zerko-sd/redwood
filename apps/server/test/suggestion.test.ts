import { afterEach, describe, expect, it } from "vitest";
import type { LlmClient } from "@redwood/suggest";
import { startServer, type PreviewLike, type Running } from "../src";

const preview: PreviewLike = {
  start: async () => ({ state: "stopped", accounts: [], logs: [] }),
  status: () => ({ state: "stopped", accounts: [], logs: [] }),
  stop: () => {}, schedule: () => {}, confirmDestructive: async () => {},
};

/** A stand-in model that knows one small app. */
const model = (delayMs = 0): LlmClient & { calls: number } => ({
  model: "fake-1", calls: 0,
  async json(prompt) {
    (this as { calls: number }).calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (prompt.startsWith("You are responsible")) return { entity: "Bus", path: "/buses" };
    if (prompt.startsWith("You are proposing fields")) return { fields: [{ name: "Plate", type: "text" }] };
    if (prompt.startsWith("Screen:")) return { operations: ["list", "create"], customActions: [] };
    if (prompt.startsWith("You are deciding who may change")) return { entities: [] };
    return { theme: "default", reason: "" };
  },
});

let srv: Running;
afterEach(() => srv?.close());

async function setup(llm: LlmClient | null) {
  srv = await startServer({ port: 0, dbPath: ":memory:", preview, llm });
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${srv.port}${path}`, {
      method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  await call("POST", "/api/auth/signup", { username: "ada", password: "correct horse" });
  const { json: project } = await call("POST", "/api/projects", { name: "Fleet" });
  const id = project.id as string;
  let rev = 1;
  const send = async (commands: unknown[]) => { const r = await call("POST", `/api/projects/${id}/commands`, { baseRevision: rev, commands }); expect(r.status).toBe(200); rev = r.json.rev; return r.json; };
  await send([
    { type: "addRole", role: { id: "role:admin", name: "Admin", description: "" } },
    { type: "addStory", story: { id: "story:a", role: "role:admin", action: "add and remove buses", reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } },
  ]);
  return { call, id, send };
}

describe("suggestions over HTTP", () => {
  it("offers one question at a time, and a person's acceptance is just the normal command call", async () => {
    const llm = model();
    const { call, id, send } = await setup(llm);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await call("GET", `/api/projects/${id}/suggestion`);
      expect(r.status).toBe(200);
      if (!r.json.suggestion) break;
      seen.push(r.json.suggestion.step);
      await send(r.json.suggestion.commands);
    }
    // One role means "everyone" and "Admin" are the same audience, so there is no audience change to propose.
    expect(seen).toEqual(["place", "fields", "operations", "access"]);
    const spec = (await call("GET", `/api/projects/${id}`)).json.spec;
    expect(spec.screens[0]).toMatchObject({ path: "/buses", stories: ["story:a"] });
    expect(spec.access[0]).toMatchObject({ role: "role:admin", operations: ["list", "read", "create"] });
  });

  it("applies nothing by itself: asking leaves the spec exactly as it was", async () => {
    const { call, id } = await setup(model());
    const before = (await call("GET", `/api/projects/${id}`)).json;
    await call("GET", `/api/projects/${id}/suggestion`);
    const after = (await call("GET", `/api/projects/${id}`)).json;
    expect(after.rev).toBe(before.rev);
    expect(after.spec).toEqual(before.spec);
  });

  it("remembers a skipped question", async () => {
    const llm = model();
    const { call, id } = await setup(llm);
    const first = (await call("GET", `/api/projects/${id}/suggestion`)).json.suggestion;
    expect((await call("POST", `/api/projects/${id}/suggestion/skip`, { key: first.key })).status).toBe(204);
    const next = (await call("GET", `/api/projects/${id}/suggestion`)).json.suggestion;
    expect(next).toBeNull(); // the only story was skipped, so nothing else is open
  });

  it("says plainly when no model is configured, and reports that to the Builder", async () => {
    const { call, id } = await setup(null);
    expect((await call("GET", "/api/ai")).json).toEqual({ enabled: false, model: null });
    const r = await call("GET", `/api/projects/${id}/suggestion`);
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/NEBIUS_API_KEY/);
  });

  it("reports the model when there is one", async () => {
    const { call } = await setup(model());
    expect((await call("GET", "/api/ai")).json).toEqual({ enabled: true, model: "fake-1" });
  });

  it("lets only someone who can edit ask, and keeps other projects invisible", async () => {
    const { id } = await setup(model());
    const stranger = await fetch(`http://127.0.0.1:${srv.port}/api/projects/${id}/suggestion`);
    expect(stranger.status).toBe(401);
    const other = await fetch(`http://127.0.0.1:${srv.port}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "bob", password: "correct horse" }) });
    const cookie = other.headers.get("set-cookie")!.split(";")[0]!;
    const peek = await fetch(`http://127.0.0.1:${srv.port}/api/projects/${id}/suggestion`, { headers: { cookie } });
    expect(peek.status).toBe(404);
  });

  it("answers a second request while one is running with 409 instead of asking the model twice", async () => {
    const llm = model(150);
    const { call, id } = await setup(llm);
    const [a, b] = await Promise.all([call("GET", `/api/projects/${id}/suggestion`), call("GET", `/api/projects/${id}/suggestion`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(llm.calls).toBe(1);
  });
});
