import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand, checkSpec, type Command, type Spec } from "@redwood/spec";
import { describeChange, nextSuggestion, recommendStories, resolveChange, staleItems } from "../src";
import { hash } from "../src/util";

const spec = checkSpec(JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"))).spec!;
const run = (s: Spec, commands: Command[]) => commands.reduce<Spec>((acc, c) => applyCommand(acc, c), s);
const llm = (answers: unknown[]) => ({ model: "fake", json: async () => answers.shift() }) as never;

describe("stories you may be missing", () => {
  it("is deterministic, and never says built for something the generator lacks", () => {
    const list = recommendStories(spec);
    expect(recommendStories(spec)).toEqual(list);
    expect(list.find((r) => r.id === "security.password-reset")?.status).toBe("spec");
    expect(list.find((r) => r.id === "security.lockout")?.status).toBe("spec");
    expect(list.filter((r) => r.group !== "coverage" && r.status === "built")).toEqual([]);
  });

  it("drops a recommendation once a story covers it", () => {
    const added = run(spec, recommendStories(spec).find((r) => r.id === "security.password-reset")!.commands);
    expect(recommendStories(added).some((r) => r.id === "security.password-reset")).toBe(false);
  });

  it("adds the role a recommendation needs when the spec has none", () => {
    const orgs = run(spec, [{ type: "addStory", story: { id: "story:x", role: "role:driver", action: "invite my team to the workspace", reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } }]);
    const rec = recommendStories(orgs).find((r) => r.id === "tenancy.create-organisation")!;
    expect(rec.role).toBe("Admin");
    expect(rec.newRole).toBe(false);
    const noAdmin = { ...orgs, roles: orgs.roles.filter((r) => r.name === "Driver"), stories: orgs.stories.filter((s) => s.role === "role:driver"), access: [], screens: [], entities: orgs.entities.map((e) => ({ ...e, workflow: undefined })) } as Spec;
    const owner = recommendStories(noAdmin).find((r) => r.id === "tenancy.create-organisation")!;
    expect(owner.newRole).toBe(true);
    expect(run(noAdmin, owner.commands).roles.some((r) => r.name === "Owner")).toBe(true);
  });

  it("finds the everyday operation a table's stories never ask for", () => {
    const made = run(spec, [
      { type: "addStory", story: { id: "story:add-depot", role: "role:admin", action: "add a depot", reason: "", acceptance: [], priority: "should", status: "accepted", origin: "human", tags: [] } },
      { type: "addEntity", entity: { id: "entity:depot", name: "Depot", fields: [], relationships: [], seed: [] } },
      { type: "addScreen", screen: { id: "screen:depots", title: "Depots", path: "/depots", entity: "entity:depot", stories: ["story:add-depot"], endpoints: [], blocks: [], bento: {}, roles: [], fields: [], placement: "nav" } },
    ]);
    const gaps = recommendStories(made).filter((r) => r.id.endsWith("entity:depot"));
    expect(gaps.map((r) => r.id)).toEqual(["coverage.view.entity:depot", "coverage.edit.entity:depot", "coverage.remove.entity:depot"]);
    expect(gaps[1]!.story).toContain("correct a depot after it is saved");
  });
});

describe("what a change to the stories leaves behind", () => {
  const story = spec.stories[0]!;
  const ai = { source: "ai" as const, storyRefs: [story.id], degraded: false, inputHash: hash([story.action]) };
  const built = run(spec, [{ type: "addField", entity: "entity:bus", field: { id: "field:depot", name: "Depot", type: "text", required: false, unique: false, provenance: ai } }]);

  it("finds nothing while the stories are as they were, and ignores hand-made decisions", () => {
    expect(staleItems(built)).toEqual([]);
    expect(staleItems(spec)).toEqual([]);
  });

  it("flags fields once a story they came from changes, and Still right settles it", () => {
    const changed = run(built, [{ type: "updateStory", id: story.id, patch: { action: "something quite different" } }]);
    const [item] = staleItems(changed);
    expect(item).toMatchObject({ step: "data", what: "Fields of Bus" });
    expect(staleItems(run(changed, item!.stillRight))).toEqual([]);
  });

  it("says so when the story is gone", () => {
    const gone = run(built, [{ type: "removeStory", id: story.id }]);
    expect(staleItems(gone)[0]!.why).toMatch(/removed/);
  });
});

describe("a change described in words", () => {
  it("turns only known names into commands", () => {
    const ops = resolveChange(spec, {
      ops: [
        { op: "set_layout", path: "/trips", layout: "board" },
        { op: "set_layout", path: "/trips", layout: "carousel" },
        { op: "set_layout", path: "/nope", layout: "board" },
        { op: "remove_fields", path: "/buses", fields: ["Capacity", "Made up"] },
        { op: "add_screen", path: "/reports", title: "Reports", table: "Trip" },
      ],
    });
    expect(ops.map((o) => o.line)).toEqual(["Show Trips as board", "Hide Capacity on Buses", "Add Reports at /reports over Trip"]);
    const next = run(spec, ops.flatMap((o) => o.commands));
    expect(next.screens.find((s) => s.path === "/buses")!.fields).toEqual(spec.entities[0]!.fields.filter((f) => f.name !== "Capacity").map((f) => f.id));
  });

  it("asks once more when the answer has no list, then reports it", async () => {
    await expect(describeChange(spec, "x", llm([{}, {}]))).rejects.toThrow(/ops missing/);
    expect(await describeChange(spec, "x", llm([{}, { ops: [] }]))).toEqual([]);
  });
});

describe("services for a custom action", () => {
  const custom = run(spec, [{ type: "addEndpoint", endpoint: { id: "endpoint:assign", entity: "entity:trip", operation: "custom", action: "Assign driver", guards: [], services: [] } }]);
  const answered = async (answer: unknown) => {
    // Every other open question is settled, so the only one left is the service.
    const decided = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const s = await nextSuggestion(custom, { llm: llm([answer, answer, answer, answer]), decided, decide: (k) => decided.add(k) }).catch(() => null);
      if (!s || s.step === "services") return s;
      decided.add(s.key);
    }
    return null;
  };

  it("offers a new service and links it", async () => {
    const s = await answered({ needsService: true, serviceName: "Dispatch mailer", kind: "email" });
    expect(s?.step).toBe("services");
    expect(run(custom, s!.commands).endpoints.find((e) => e.id === "endpoint:assign")!.services).toEqual(["service:dispatch-mailer"]);
  });

  it("asks nothing further when no service is needed", async () => {
    expect(await answered({ needsService: false, serviceName: null })).toBeNull();
  });
});
