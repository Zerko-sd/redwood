import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand, checkSpec } from "@redwood/spec";
import { diffSpecs } from "../src";

const base = checkSpec(JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"))).spec!;

describe("migrations", () => {
  it("creates every table from nothing", () => {
    const m = diffSpecs(null, base);
    expect(m.sql).toContain('CREATE TABLE "bus"');
    expect(m.sql).toContain('CREATE TABLE "trip"');
    expect(m.sql).toContain('UNIQUE ("plate")');
    expect(m.destructive).toEqual([]);
  });

  it("gives reference fields a foreign key", () => {
    expect(diffSpecs(null, base).sql).toContain('FOREIGN KEY ("bus") REFERENCES "bus" ("id")');
  });

  it("is empty when nothing changed", () => {
    expect(diffSpecs(base, base).sql).toBe("");
  });

  it("treats a renamed field as a rename, not drop + add", () => {
    const next = applyCommand(base, { type: "updateField", entity: "entity:bus", id: "field:plate", patch: { name: "Plate Number" } });
    const m = diffSpecs(base, next);
    expect(m.ops).toEqual([{ kind: "renameColumn", table: "bus", from: "plate", to: "plate_number" }]);
    expect(m.destructive).toEqual([]);
  });

  it("adds a required column with a safe default", () => {
    const next = applyCommand(base, {
      type: "addField", entity: "entity:bus",
      field: { id: "field:model", name: "Model", type: "text", required: true },
    });
    expect(diffSpecs(base, next).sql).toContain(`ADD COLUMN "model" TEXT NOT NULL DEFAULT ''`);
  });

  it("flags drops and withholds them until confirmed", () => {
    const next = applyCommand(base, { type: "removeField", entity: "entity:bus", id: "field:capacity" });
    const held = diffSpecs(base, next);
    expect(held.destructive).toHaveLength(1);
    expect(held.sql).toBe("");
    expect(diffSpecs(base, next, { allowDestructive: true }).sql).toContain('DROP COLUMN "capacity"');
  });
});
