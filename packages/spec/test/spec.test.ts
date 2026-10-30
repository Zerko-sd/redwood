import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand, canonicalJson, checkSpec, CommandError, specHash, touches } from "../src";

const raw = JSON.parse(
  readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"),
);

describe("example spec", () => {
  it("validates with no errors", () => {
    const { issues } = checkSpec(raw);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("hashes the same regardless of key order", () => {
    const { spec } = checkSpec(raw);
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v;
    const shuffled = reverseKeys(spec);
    expect(Object.keys(shuffled as object)).not.toEqual(Object.keys(spec!));
    expect(specHash(shuffled)).toBe(specHash(spec));
    expect(canonicalJson(spec)).toBe(canonicalJson(JSON.parse(canonicalJson(spec))));
  });
});

describe("checks", () => {
  it("rejects a story with an unknown role", () => {
    const bad = structuredClone(raw);
    bad.stories[0].role = "role:ghost";
    expect(checkSpec(bad).issues.some((i) => i.message.includes("unknown role"))).toBe(true);
  });

  it('rejects a bento "yes" with no cited story', () => {
    const bad = structuredClone(raw);
    bad.screens[0].bento = { "lists-many": { answer: true, because: [] } };
    expect(checkSpec(bad).issues.some((i) => i.message.includes("must cite"))).toBe(true);
  });
});

describe("commands", () => {
  const base = checkSpec(raw).spec!;

  it("applies without mutating the input", () => {
    const before = specHash(base);
    const next = applyCommand(base, {
      type: "addRole",
      role: { id: "role:auditor", name: "Auditor" },
    });
    expect(next.roles).toHaveLength(3);
    expect(specHash(base)).toBe(before);
  });

  it("refuses a command that breaks a reference", () => {
    expect(() =>
      applyCommand(base, {
        type: "addStory",
        story: { id: "story:x", role: "role:nobody", action: "do x" },
      }),
    ).toThrow(CommandError);
  });

  it("removing an entity cleans its endpoints, access and screen links", () => {
    const next = applyCommand(base, { type: "removeEntity", id: "entity:trip" });
    expect(next.endpoints.every((e) => e.entity !== "entity:trip")).toBe(true);
    expect(next.access.every((a) => a.entity !== "entity:trip")).toBe(true);
    const screen = next.screens.find((s) => s.id === "screen:trips")!;
    expect(screen.entity).toBeUndefined();
    expect(screen.endpoints).toEqual([]);
  });

  it("refuses to remove an entity another entity still references", () => {
    expect(() => applyCommand(base, { type: "removeEntity", id: "entity:bus" })).toThrow(/still referenced/);
  });
});

describe("seed rows", () => {
  const base = checkSpec(raw).spec!;

  it("survive a field rename because they are keyed by field id", () => {
    const next = applyCommand(base, { type: "updateField", entity: "entity:bus", id: "field:plate", patch: { name: "Plate Number" } });
    expect(next.entities[0]!.seed[0]).toEqual(base.entities[0]!.seed[0]);
  });

  it("lose the key when the field is removed", () => {
    const next = applyCommand(base, { type: "removeField", entity: "entity:bus", id: "field:capacity" });
    expect(Object.keys(next.entities[0]!.seed[0]!)).toEqual(["field:plate"]);
  });

  it("are rejected when a key is not a field id", () => {
    const bad = structuredClone(raw);
    bad.entities[0].seed = [{ plate: "x" }];
    expect(checkSpec(bad).issues.some((i) => i.message.includes("not a field id"))).toBe(true);
  });
});

describe("touches", () => {
  it("names the items a command changes", () => {
    expect(touches({ type: "updateField", entity: "entity:bus", id: "field:plate", patch: {} })).toEqual(["entity:bus/field:plate"]);
    expect(touches({ type: "grant", rule: { role: "role:admin", entity: "entity:bus", operations: [] } })).toEqual(["access:role:admin:entity:bus"]);
  });

  it("treats unknown commands as touching everything", () => {
    expect(touches({ type: "restore", from: 3 })).toEqual(["*"]);
  });
});

describe("commands behind the sheet", () => {
  const base = checkSpec(raw).spec!;

  it("renames a role and a table, and refuses to remove a role that stories use", () => {
    expect(applyCommand(base, { type: "updateRole", id: "role:admin", patch: { name: "Manager" } }).roles[0]!.name).toBe("Manager");
    expect(applyCommand(base, { type: "updateEntity", id: "entity:bus", patch: { name: "Coach" } }).entities[0]!.name).toBe("Coach");
    expect(() => applyCommand(base, { type: "removeRole", id: "role:admin" })).toThrow(/still used by/);
  });

  it("removes an unused role from everything that named it", () => {
    const withRole = applyCommand(base, { type: "addRole", role: { id: "role:temp", name: "Temp", description: "" } });
    const used = applyCommand(
      applyCommand(withRole, { type: "setSubProjects", subProjects: [{ name: "Ops", roles: ["role:temp"] }] }),
      { type: "grant", rule: { role: "role:temp", entity: "entity:bus", operations: ["list"], hiddenFields: [], readOnlyFields: [] } },
    );
    const next = applyCommand(used, { type: "removeRole", id: "role:temp" });
    expect(next.roles.some((r) => r.id === "role:temp")).toBe(false);
    expect(next.access.some((a) => a.role === "role:temp")).toBe(false);
    expect(next.subProjects[0]!.roles).toEqual([]);
  });

  it("carries a field rename into the workflow and the access rules", () => {
    const trip = base.entities.find((e) => e.workflow)!;
    const f = trip.fields.find((x) => x.name === trip.workflow!.field)!;
    const next = applyCommand(base, { type: "updateField", entity: trip.id, id: f.id, patch: { name: "Progress" } });
    expect(next.entities.find((e) => e.id === trip.id)!.workflow!.field).toBe("Progress");
  });

  it("clears optional values, which a JSON patch alone cannot do", () => {
    const set = applyCommand(base, { type: "updateScreen", id: "screen:trips", patch: { layout: "board" } });
    expect(set.screens.find((s) => s.id === "screen:trips")!.layout).toBe("board");
    const cleared = applyCommand(set, { type: "updateScreen", id: "screen:trips", patch: {}, clear: ["layout"] });
    expect(cleared.screens.find((s) => s.id === "screen:trips")!.layout).toBeUndefined();
  });

  it("updates and removes endpoints and services, keeping links tidy", () => {
    const withService = applyCommand(base, { type: "addService", service: { id: "service:mail", name: "Mail", kind: "email", secrets: [] } });
    const ep = base.endpoints[0]!.id;
    const linked = applyCommand(withService, { type: "updateEndpoint", id: ep, patch: { services: ["service:mail"] } });
    expect(applyCommand(linked, { type: "removeService", id: "service:mail" }).endpoints[0]!.services).toEqual([]);
    const gone = applyCommand(base, { type: "removeEndpoint", id: ep });
    expect(gone.screens.flatMap((s) => s.endpoints)).not.toContain(ep);
    expect(() => applyCommand(linked, { type: "updateEndpoint", id: ep, patch: { services: ["service:nope"] } })).toThrow(/unknown service/);
  });

  it("moves an item before another, or to the end", () => {
    const [a, b] = base.stories;
    const front = applyCommand(base, { type: "moveItem", list: "stories", id: b!.id, before: a!.id });
    expect(front.stories[0]!.id).toBe(b!.id);
    const end = applyCommand(base, { type: "moveItem", list: "stories", id: a!.id });
    expect(end.stories.at(-1)!.id).toBe(a!.id);
    const fields = base.entities[0]!.fields;
    const moved = applyCommand(base, { type: "moveItem", list: "fields", entity: "entity:bus", id: fields[1]!.id, before: fields[0]!.id });
    expect(moved.entities[0]!.fields[0]!.id).toBe(fields[1]!.id);
  });

  it("keeps sample rows by their own id, and clears links to a removed row", () => {
    const one = applyCommand(base, { type: "setSeed", entity: "entity:bus", rows: [{ id: "r1", "field:plate": "A" }] });
    const put = applyCommand(one, { type: "putSeedRow", entity: "entity:bus", row: { id: "r1", "field:plate": "B" } });
    expect(put.entities[0]!.seed).toEqual([{ id: "r1", "field:plate": "B" }]);
    const two = applyCommand(put, { type: "putSeedRow", entity: "entity:bus", row: { id: "r2", "field:plate": "C" } });
    expect(two.entities[0]!.seed).toHaveLength(2);
    const trip = base.entities.find((e) => e.fields.some((f) => f.references === "entity:bus"));
    if (trip) {
      const ref = trip.fields.find((f) => f.references === "entity:bus")!;
      const linked = applyCommand(two, { type: "setSeed", entity: trip.id, rows: [{ id: "t1", [ref.id]: "r1" }] });
      const after = applyCommand(linked, { type: "removeSeedRow", entity: "entity:bus", id: "r1" });
      expect(after.entities.find((e) => e.id === trip.id)!.seed[0]).toEqual({ id: "t1" });
    }
  });

  it("refuses duplicate sample row ids", () => {
    expect(() => applyCommand(base, { type: "setSeed", entity: "entity:bus", rows: [{ id: "x" }, { id: "x" }] })).toThrow(/duplicate id/);
  });

  it("checks what a screen shows against its own table", () => {
    expect(() => applyCommand(base, { type: "updateScreen", id: "screen:buses", patch: { fields: ["field:route"] } })).toThrow(/not a field/);
  });

  it("names every new command in touches, scoped so unrelated edits never clash", () => {
    expect(touches({ type: "putSeedRow", entity: "entity:bus", row: { id: "r1" } })).toEqual(["seed:entity:bus:r1"]);
    expect(touches({ type: "removeSeedRow", entity: "entity:bus", id: "r1" })).toEqual(["seed:entity:bus:r1"]);
    expect(touches({ type: "setSeed", entity: "entity:bus", rows: [] })).toEqual(["seed:entity:bus"]);
    expect(touches({ type: "setSubProjects", subProjects: [] })).toEqual(["subProjects"]);
    expect(touches({ type: "moveItem", list: "stories", id: "story:a" })).toEqual(["order::stories"]);
    expect(touches({ type: "updateRole", id: "role:a", patch: {} })).toEqual(["role:a"]);
    expect(touches({ type: "removeRole", id: "role:a" })).toEqual(["role:a"]);
    expect(touches({ type: "updateEntity", id: "entity:a", patch: { name: "x" } })).toEqual(["entity:a"]);
    expect(touches({ type: "updateEndpoint", id: "endpoint:a", patch: {} })).toEqual(["endpoint:a"]);
    expect(touches({ type: "removeEndpoint", id: "endpoint:a" })).toEqual(["endpoint:a"]);
    expect(touches({ type: "addService", service: { id: "service:a" } })).toEqual(["service:a"]);
    expect(touches({ type: "updateService", id: "service:a", patch: {} })).toEqual(["service:a"]);
    expect(touches({ type: "removeService", id: "service:a" })).toEqual(["service:a"]);
    expect(touches({ type: "addField", entity: "entity:a", field: { id: "field:x" } })).toEqual(["entity:a/field:x"]);
    expect(touches({ type: "addField", entity: "entity:b", field: { id: "field:x" } })).not.toEqual(touches({ type: "addField", entity: "entity:a", field: { id: "field:x" } }));
  });
});

describe("workflow and theme commands", () => {
  const base = checkSpec(JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"))).spec!;

  it("sets and clears a workflow, and refuses one on a field that is not there", () => {
    const wf = { field: "Status", states: ["scheduled", "done"], transitions: [{ from: "scheduled", to: "done", roles: ["role:admin"] }] };
    const set = applyCommand(base, { type: "setWorkflow", entity: "entity:trip", workflow: wf });
    expect(set.entities.find((e) => e.id === "entity:trip")!.workflow!.states).toEqual(["scheduled", "done"]);
    const cleared = applyCommand(set, { type: "setWorkflow", entity: "entity:trip", workflow: null });
    expect(cleared.entities.find((e) => e.id === "entity:trip")!.workflow).toBeUndefined();
    expect(() => applyCommand(base, { type: "setWorkflow", entity: "entity:trip", workflow: { ...wf, field: "Nope" } })).toThrow(/not a field/);
  });

  it("refuses an owner field that is not a field of the entity", () => {
    expect(() =>
      applyCommand(base, { type: "grant", rule: { role: "role:driver", entity: "entity:trip", operations: ["list"], ownerField: "Ghost", hiddenFields: [] } }),
    ).toThrow(/not a field/);
  });

  it("changes only the theme keys it is given", () => {
    const s = applyCommand(base, { type: "setTheme", theme: { preset: "harbor" } });
    expect(s.theme).toMatchObject({ kit: "shadcn", preset: "harbor" });
    expect(touches({ type: "setTheme", theme: {} })).toEqual(["theme"]);
  });
});
