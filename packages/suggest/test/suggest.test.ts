import { describe, expect, it } from "vitest";
import { generate } from "@redwood/generator";
import { applyCommand, checkSpec, type Spec } from "@redwood/spec";
import {
  LlmBadOutput, LlmUnavailable, nextSuggestion, openAiCompatible, parseJsonObject, withCache, type LlmClient, type Suggestion,
} from "../src";

const blank = (): Spec =>
  checkSpec({ schemaVersion: 1, title: "Bus Fleet", roles: [], stories: [], entities: [], screens: [], endpoints: [], services: [], access: [], theme: {} }).spec!;

/** A stand-in model: answers by recognising what the prompt is about. It records every prompt it was sent. */
function fakeModel(answer: (prompt: string, schema: Record<string, any>) => unknown): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return { model: "fake-1", prompts, async json(prompt, schema) { prompts.push(prompt); return answer(prompt, schema as Record<string, any>); } };
}

const storyIn = (p: string) => /Current User Story:\n"(.*)"/.exec(p)?.[1] ?? "";

const scripted = fakeModel((prompt) => {
  if (prompt.startsWith("You are responsible for identifying")) {
    const s = storyIn(prompt);
    if (/trip/i.test(s)) return { entity: "Trip", path: "/trips" };
    return { entity: "Bus", path: "/buses" };
  }
  if (prompt.startsWith("You are proposing fields")) {
    if (prompt.includes('Entity: "Bus"')) return { fields: [{ name: "Plate", type: "text" }, { name: "Capacity", type: "number" }] };
    return { fields: [
      { name: "Route", type: "text" },
      { name: "Bus", type: "reference", references: "Bus" },
      { name: "Driver", type: "text" },
      { name: "Status", type: "choice", options: ["scheduled", "running", "done"] },
    ] };
  }
  if (prompt.startsWith("Screen:")) {
    if (prompt.includes('"/buses"')) return { operations: ["list", "create", "update", "delete"], customActions: [] };
    return { operations: ["list", "create", "update"], customActions: [] };
  }
  if (prompt.startsWith("You are deciding who may change what")) {
    return { entities: [{ name: "Trip",
      actions: [{ field: "Status", label: "Start", value: "running", roles: ["Driver", "Admin"] }, { field: "Status", label: "Finish", value: "done", roles: ["Driver"] }],
      own_records: [{ role: "Driver", field: "Driver" }] }] };
  }
  if (prompt.startsWith("You are choosing how a generated app looks")) return { theme: "harbor", reason: "Staff at a desk all day." };
  throw new Error("unexpected prompt: " + prompt.slice(0, 60));
});

/** Accepts every suggestion in turn, the way "accept all" does. */
async function runAll(spec: Spec, llm: LlmClient | null, decided = new Set<string>()) {
  const steps: Suggestion[] = [];
  for (let i = 0; i < 40; i++) {
    const s = await nextSuggestion(spec, { llm, decided, decide: (k) => decided.add(k) });
    if (!s) return { spec, steps };
    if (s.problem) throw new Error(`${s.step}: ${s.problem}`);
    steps.push(s);
    for (const c of s.commands) spec = applyCommand(spec, c);
  }
  throw new Error("did not finish");
}

describe("from stories to a spec", () => {
  const start = () => {
    let s = blank();
    s = applyCommand(s, { type: "addRole", role: { id: "role:admin", name: "Admin", description: "" } });
    s = applyCommand(s, { type: "addRole", role: { id: "role:driver", name: "Driver", description: "" } });
    const story = (id: string, role: string, action: string) =>
      ({ type: "addStory", story: { id, role, action, reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } }) as const;
    s = applyCommand(s, story("story:buses", "role:admin", "add, edit and remove buses"));
    s = applyCommand(s, story("story:schedule", "role:admin", "schedule a trip for a bus and a driver"));
    s = applyCommand(s, story("story:mine", "role:driver", "see my own trips"));
    s = applyCommand(s, story("story:progress", "role:driver", "mark my trip as running and then done"));
    return s;
  };

  it("builds a valid spec step by step, asking in a fixed order", async () => {
    const { spec, steps } = await runAll(start(), scripted);
    expect(steps.map((s) => s.step)).toEqual([
      "place", "place", "place", "place", // each story, one at a time
      "fields", "fields", "operations", "operations", "audience", "access", "rules", "theme",
    ]);
    expect(checkSpec(spec).issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(spec.entities.map((e) => e.name)).toEqual(["Bus", "Trip"]);
    expect(spec.screens.map((s) => [s.path, s.stories.length])).toEqual([["/buses", 1], ["/trips", 3]]);
    // every story ended up on a screen, so none is flagged as a gap
    expect(spec.stories.every((st) => spec.screens.some((sc) => sc.stories.includes(st.id)))).toBe(true);
  });

  it("derives who opens a page and who can do what from the stories, not from the model", async () => {
    const { spec, steps } = await runAll(start(), scripted);
    expect(steps.find((s) => s.step === "audience")!.source).toBe("rule");
    expect(spec.screens.find((s) => s.path === "/buses")!.roles).toEqual(["role:admin"]);
    expect(spec.screens.find((s) => s.path === "/trips")!.roles).toEqual([]); // both roles use it: everyone
    const driver = spec.access.find((a) => a.role === "role:driver" && a.entity === "entity:trip")!;
    expect(driver.operations).toEqual(["list", "read", "create", "update"]);
    expect(spec.access.some((a) => a.role === "role:driver" && a.entity === "entity:bus")).toBe(false);
  });

  it("turns status buttons into workflow transitions and own-records into an owner field", async () => {
    const { spec } = await runAll(start(), scripted);
    const trip = spec.entities.find((e) => e.name === "Trip")!;
    expect(trip.workflow).toMatchObject({ field: "Status", states: ["scheduled", "running", "done"] });
    expect(trip.workflow!.transitions).toContainEqual({ from: "scheduled", to: "running", roles: ["role:driver", "role:admin"] });
    expect(trip.workflow!.transitions.some((t) => t.to === "scheduled")).toBe(false); // no button back to the start
    expect(spec.access.find((a) => a.role === "role:driver" && a.entity === "entity:trip")!.ownerField).toBe("Driver");
    expect(spec.theme.preset).toBe("harbor");
  });

  it("records where every created item came from", async () => {
    const { spec } = await runAll(start(), scripted);
    const bus = spec.entities.find((e) => e.name === "Bus")!;
    expect(bus.provenance).toMatchObject({ source: "ai", model: "fake-1", promptVersion: "v1", storyRefs: ["story:buses"] });
    expect(bus.provenance!.inputHash).toBeTruthy();
    expect(spec.endpoints.every((e) => e.provenance?.source === "ai")).toBe(true);
  });

  it("produces a spec the generator accepts", async () => {
    const { spec } = await runAll(start(), scripted);
    const { manifest } = generate(spec);
    expect(Object.keys(manifest.files ?? manifest).length).toBeGreaterThan(10);
  });

  it("gives the model only the closed lists and what it needs, never the whole spec", async () => {
    scripted.prompts.length = 0;
    await runAll(start(), scripted);
    const fieldsPrompt = scripted.prompts.find((p) => p.includes('Entity: "Bus"') && p.startsWith("You are proposing fields"))!;
    expect(fieldsPrompt).toContain("add, edit and remove buses");
    expect(fieldsPrompt).not.toContain("see my own trips"); // another table's story is not in this prompt
  });
});

describe("what the model is not allowed to do", () => {
  const one = () => {
    let s = blank();
    s = applyCommand(s, { type: "addRole", role: { id: "role:admin", name: "Admin", description: "" } });
    return applyCommand(s, { type: "addStory", story: { id: "story:a", role: "role:admin", action: "manage buses", reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } });
  };

  it("refuses a verb as a table name, asks once more, then reports instead of guessing", async () => {
    const llm = fakeModel(() => ({ entity: "Manage", path: "/manage" }));
    const s = await nextSuggestion(one(), { llm });
    expect(llm.prompts).toHaveLength(2);
    expect(s).toMatchObject({ step: "place", commands: [] });
    expect(s!.problem).toMatch(/verb/);
  });

  it("drops a path that cannot be used and falls back to the table's own list path", async () => {
    const llm = fakeModel(() => ({ entity: "Bus", path: "/bus/:id/Edit page" }));
    const s = await nextSuggestion(one(), { llm });
    expect(s!.commands.find((c) => c.type === "addScreen")).toMatchObject({ screen: { path: "/buses" } });
  });

  it("does not let a page that belongs to another table be taken over", async () => {
    let spec = one();
    spec = applyCommand(spec, { type: "addEntity", entity: { id: "entity:trip", name: "Trip", fields: [], relationships: [], seed: [] } });
    spec = applyCommand(spec, { type: "addScreen", screen: { id: "screen:trips", title: "Trips", path: "/buses", entity: "entity:trip", stories: [], endpoints: [], blocks: [], bento: {}, roles: [] } });
    const llm = fakeModel(() => ({ entity: "Bus", path: "/buses" }));
    const s = await nextSuggestion(spec, { llm });
    expect(s!.commands.find((c) => c.type === "addScreen")).toMatchObject({ screen: { path: "/buses-2" } });
  });

  it("refuses an operation that is not in the list", async () => {
    const llm = fakeModel((p) => p.startsWith("Screen:") ? { operations: ["list", "purge"], customActions: [] } : p.startsWith("You are proposing") ? { fields: [{ name: "Plate", type: "text" }] } : { entity: "Bus", path: "/buses" });
    let spec = one();
    for (let i = 0; i < 2; i++) { const s = (await nextSuggestion(spec, { llm }))!; for (const c of s.commands) spec = applyCommand(spec, c); }
    const s = await nextSuggestion(spec, { llm });
    expect(s).toMatchObject({ step: "operations", commands: [] });
    expect(s!.problem).toMatch(/purge/);
  });

  it("will not serve a story that changes records with a screen that can only read", async () => {
    const llm = fakeModel((p) => p.startsWith("Screen:") ? { operations: ["list"], customActions: [] } : p.startsWith("You are proposing") ? { fields: [{ name: "Plate", type: "text" }] } : { entity: "Bus", path: "/buses" });
    let spec = one();
    for (let i = 0; i < 2; i++) { const s = (await nextSuggestion(spec, { llm }))!; for (const c of s.commands) spec = applyCommand(spec, c); }
    expect((await nextSuggestion(spec, { llm }))!.problem).toMatch(/change records/);
  });

  it("falls back to a single Name field when the stories imply none, and says so", async () => {
    const llm = fakeModel((p) => p.startsWith("You are proposing") ? { fields: [] } : { entity: "Bus", path: "/buses" });
    let spec = one();
    const first = (await nextSuggestion(spec, { llm }))!;
    for (const c of first.commands) spec = applyCommand(spec, c);
    const s = (await nextSuggestion(spec, { llm }))!;
    expect(s.source).toBe("rule");
    expect(s.lines.join(" ")).toMatch(/starts with a name/);
  });

  it("drops one bad status button but keeps the rest of the answer", async () => {
    let spec = (await runAll(startForRules(), scripted)).spec;
    expect(spec.entities.find((e) => e.name === "Trip")!.workflow).toBeTruthy();
    const llm = fakeModel(() => ({ entities: [{ name: "Trip",
      actions: [{ field: "Status", label: "Scheduled", value: "scheduled", roles: ["Admin"] }, { field: "Status", label: "Start", value: "running", roles: ["Driver"] }, { field: "Nope", label: "Go", value: "x", roles: ["Admin"] }],
      own_records: [] }] }));
    spec = applyCommand(spec, { type: "setWorkflow", entity: "entity:trip", workflow: null });
    const s = (await nextSuggestion(spec, { llm, decided: new Set(["theme-skip"]) }))!;
    const wf = s.commands.find((c) => c.type === "setWorkflow") as any;
    expect(wf.workflow.transitions.map((t: any) => t.to)).toEqual(["running", "running"]); // the value-named and unknown ones are gone
  });
});

function startForRules(): Spec {
  let s = blank();
  s = applyCommand(s, { type: "addRole", role: { id: "role:admin", name: "Admin", description: "" } });
  s = applyCommand(s, { type: "addRole", role: { id: "role:driver", name: "Driver", description: "" } });
  const add = (id: string, role: string, action: string) =>
    applyCommand(s, { type: "addStory", story: { id, role, action, reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } });
  s = add("story:buses", "role:admin", "add, edit and remove buses");
  s = add("story:schedule", "role:admin", "schedule a trip for a bus and a driver");
  s = add("story:mine", "role:driver", "see my own trips");
  s = add("story:progress", "role:driver", "mark my trip as running and then done");
  return s;
}

describe("being asked again, and not", () => {
  it("does not ask a dismissed question again, and asks again when the story changes", async () => {
    const llm = fakeModel(() => ({ entity: "Bus", path: "/buses" }));
    const spec = startForRules();
    const first = (await nextSuggestion(spec, { llm }))!;
    const second = (await nextSuggestion(spec, { llm, decided: new Set([first.key]) }))!;
    expect(second.key).not.toBe(first.key);
    const edited = applyCommand(spec, { type: "updateStory", id: "story:buses", patch: { action: "keep a register of vehicles" } });
    const again = (await nextSuggestion(edited, { llm }))!;
    expect(again.key).not.toBe(first.key);
  });

  it("settles a question that needs no change instead of asking it forever", async () => {
    const { spec } = await runAll(startForRules(), scripted);
    const decided = new Set<string>();
    const llm = fakeModel((p) => p.startsWith("You are choosing") ? { theme: "harbor", reason: "same" } : { entities: [] });
    expect(await nextSuggestion(spec, { llm, decided, decide: (k) => decided.add(k) })).toBeNull();
    expect([...decided].some((k) => k.startsWith("theme:"))).toBe(true);
    const calls = llm.prompts.length;
    await nextSuggestion(spec, { llm, decided });
    expect(llm.prompts.length).toBe(calls); // nothing asked the second time
  });

  it("needs no model when there is nothing left for one to decide", async () => {
    const { spec } = await runAll(startForRules(), scripted);
    const decided = new Set<string>();
    await nextSuggestion(spec, { llm: fakeModel(() => ({ entities: [], theme: "harbor", reason: "" })), decided, decide: (k) => decided.add(k) });
    expect(await nextSuggestion(spec, { llm: null, decided })).toBeNull();
  });

  it("says so plainly when a model is needed and none is set", async () => {
    await expect(nextSuggestion(startForRules(), { llm: null })).rejects.toThrow(LlmUnavailable);
    await expect(nextSuggestion(startForRules(), { llm: null })).rejects.toThrow(/NEBIUS_API_KEY/);
  });
});

describe("the model client", () => {
  it("reads JSON out of fences, thinking blocks and chatty sentences", () => {
    expect(parseJsonObject('<think>hmm</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Sure! Here it is: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonObject("no json here")).toThrow(LlmBadOutput);
    expect(() => parseJsonObject("[1,2]")).toThrow(LlmBadOutput);
  });

  it("asks for the schema first, falls back to plain JSON once, and remembers that", async () => {
    const formats: string[] = [];
    const fetchFake = (async (_u: unknown, init: any) => {
      const body = JSON.parse(init.body);
      formats.push(body.response_format.type);
      if (body.response_format.type === "json_schema") return new Response("{}", { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    }) as typeof fetch;
    const llm = openAiCompatible({ baseUrl: "https://x.test/v1/", apiKey: "k", model: "m" }, fetchFake);
    expect(await llm.json("p", {})).toEqual({ ok: true });
    expect(await llm.json("p2", {})).toEqual({ ok: true });
    expect(formats).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("sends temperature 0 and a fixed seed, and never puts the server's reply in an error", async () => {
    let sent: any;
    const fetchFake = (async (_u: unknown, init: any) => { sent = JSON.parse(init.body); return new Response("secret account details", { status: 500 }); }) as typeof fetch;
    const llm = openAiCompatible({ baseUrl: "https://x.test/v1", apiKey: "sk-123", model: "m" }, fetchFake);
    const err = (await llm.json("p", {}).catch((e: unknown) => e)) as Error;
    expect(sent).toMatchObject({ temperature: 0, seed: 0 });
    expect(err).toBeInstanceOf(LlmUnavailable);
    expect(String(err.message)).not.toMatch(/secret|sk-123/);
  });

  it("remembers answers but never failures", async () => {
    let n = 0;
    const flaky: LlmClient = { model: "m", async json() { if (++n === 1) throw new LlmUnavailable("down"); return { v: n }; } };
    const cached = withCache(flaky);
    await expect(cached.json("p", {})).rejects.toThrow();
    expect(await cached.json("p", {})).toEqual({ v: 2 });
    expect(await cached.json("p", {})).toEqual({ v: 2 });
    expect(n).toBe(2);
  });
});
