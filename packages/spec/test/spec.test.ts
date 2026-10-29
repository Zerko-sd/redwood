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
    expect(touches({ type: "updateField", entity: "entity:bus", id: "field:plate", patch: {} })).toEqual(["field:plate"]);
    expect(touches({ type: "grant", rule: { role: "role:admin", entity: "entity:bus", operations: [] } })).toEqual(["access:role:admin:entity:bus"]);
  });

  it("treats unknown commands as touching everything", () => {
    expect(touches({ type: "restore", from: 3 })).toEqual(["*"]);
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
