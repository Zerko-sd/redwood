import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand, checkSpec } from "@redwood/spec";
import { planApp } from "../src";

const spec = checkSpec(JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"))).spec!;

describe("planner", () => {
  const plans = planApp(spec);
  const trips = plans.find((p) => p.screen === "screen:trips")!;
  const buses = plans.find((p) => p.screen === "screen:buses")!;

  it("plans a table, search and form for buses, citing stories", () => {
    const parts = buses.items.map((i) => i.part);
    expect(parts).toEqual(expect.arrayContaining(["Table", "SearchBox", "Form"]));
    expect(buses.items.find((i) => i.part === "Table")!.because).toContain("story:manage-buses");
  });

  it("plans a toolbar, a dialog for writes, and a record page for a list", () => {
    const parts = buses.items.map((i) => i.part);
    expect(parts).toEqual(expect.arrayContaining(["Toolbar", "Dialog", "RecordPage"]));
    expect(buses.items.find((i) => i.part === "RecordPage")!.requires).toBe("list");
  });

  it("shows a custom action as a visible gap instead of dropping it", () => {
    const s = applyCommand(spec, {
      type: "addEndpoint",
      endpoint: { id: "endpoint:assign", entity: "entity:trip", operation: "custom", action: "Assign Driver" },
    });
    const withEp = applyCommand(s, {
      type: "addScreen",
      screen: { id: "screen:dispatch", title: "Dispatch", path: "/dispatch", entity: "entity:trip", stories: ["story:schedule-trips"], endpoints: ["endpoint:trips-list", "endpoint:assign"], roles: ["role:admin"] },
    });
    const p = planApp(withEp).find((x) => x.screen === "screen:dispatch")!;
    expect(p.actions).toEqual([{ endpoint: "endpoint:assign", action: "Assign Driver", label: "Assign Driver" }]);
    expect(p.placeholders.some((x) => x.what === "endpoint:assign")).toBe(true);
  });

  it("adds state buttons only where the entity has a workflow", () => {
    expect(trips.items.some((i) => i.part === "StateButtons")).toBe(true);
    expect(buses.items.some((i) => i.part === "StateButtons")).toBe(false);
  });

  it("leaves totals undecided and says so", () => {
    expect(trips.answers["shows-totals"]!.answer).toBe("undecided");
    expect(trips.dropped.some((d) => d.part === "StatCards")).toBe(true);
  });

  it("prefers a saved answer over the rule", () => {
    const s = structuredClone(spec);
    s.screens[0]!.bento = { "can-delete": { answer: false, because: [] } };
    const p = planApp(s)[0]!;
    expect(p.answers["can-delete"]).toMatchObject({ answer: false, source: "saved" });
  });
});
