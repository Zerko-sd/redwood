import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCommand, checkSpec, type Command, type Spec } from "@redwood/spec";
import { canReorder, cellToCommands, columnsOf, createRow, ghostDiff, ghostKey, moveRow, removeRow, specToRows, tabIdForEntity, tabsFor } from "../src/sheet/bind";
import { SheetError } from "../src/sheet/defs";
import { flagsFor, flagKey } from "../src/sheet/rules";

const raw = JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"));
const spec = checkSpec(raw).spec!;
const run = (s: Spec, commands: Command[]) => commands.reduce<Spec>((acc, c) => applyCommand(acc, c), s);
const write = (s: Spec, tab: string, row: string, col: string, value: string) => run(s, cellToCommands(s, tab, row, col, value));
const cell = (s: Spec, tab: string, row: string, col: string) => specToRows(s, tab).find((r) => r.id === row)?.cells[col];

describe("every tab", () => {
  for (const tab of tabsFor(spec)) {
    it(`${tab.name}: rows carry every column`, () => {
      const cols = columnsOf(spec, tab.id).map((c) => c.key);
      expect(cols.length).toBeGreaterThan(0);
      for (const r of specToRows(spec, tab.id)) expect(Object.keys(r.cells)).toEqual(expect.arrayContaining(cols));
    });

    it(`${tab.name}: writing a cell's own value changes nothing the sheet can see`, () => {
      if (tab.fixed) return;
      for (const row of specToRows(spec, tab.id)) {
        for (const col of columnsOf(spec, tab.id)) {
          if (col.readOnly?.(row)) continue;
          const after = write(spec, tab.id, row.id, col.key, row.cells[col.key] ?? "");
          expect(cell(after, tab.id, row.id, col.key)).toBe(row.cells[col.key]);
        }
      }
    });
  }

  it("keeps row ids stable when other rows change", () => {
    const before = specToRows(spec, "stories").map((r) => r.id);
    const after = write(spec, "stories", before[0]!, "action", "something else entirely");
    expect(specToRows(after, "stories").map((r) => r.id)).toEqual(before);
  });
});

describe("roles", () => {
  it("adds a role, and groups it under a sub-project", () => {
    const next = run(spec, createRow(spec, "roles", { name: "Dispatcher", subProjects: "Control room" })!);
    expect(cell(next, "roles", "role:dispatcher", "subProjects")).toBe("Control room");
    expect(specToRows(next, "list-subprojects").map((r) => r.cells.name)).toEqual(["Control room"]);
  });

  it("drops a sub-project once no role is in it", () => {
    const next = run(spec, createRow(spec, "roles", { name: "Dispatcher", subProjects: "Control room" })!);
    expect(write(next, "roles", "role:dispatcher", "subProjects", "").subProjects).toEqual([]);
  });

  it("waits for a name", () => {
    expect(createRow(spec, "roles", { description: "No name yet" })).toBeNull();
  });
});

describe("stories", () => {
  const blank = run(spec, createRow(spec, "stories", { action: "track the fleet", role: "Admin" })!);
  const id = "story:track-the-fleet";

  it("needs a role somewhere", () => {
    const none = { ...spec, roles: [], stories: [], screens: [], access: [] } as Spec;
    expect(() => createRow(none, "stories", { action: "x" })).toThrow(SheetError);
  });

  it("places a story by Entity, adding the table and a page with CRUD", () => {
    const next = write(blank, "stories", id, "entity", "Depot");
    expect(cell(next, "stories", id, "path")).toBe("/depots");
    const screen = next.screens.find((s) => s.path === "/depots")!;
    expect(screen.entity).toBe("entity:depot");
    expect(screen.endpoints).toHaveLength(5);
  });

  it("joins an existing page when the Path is already taken", () => {
    const next = write(blank, "stories", id, "path", "/buses");
    expect(next.screens.find((s) => s.path === "/buses")!.stories).toContain(id);
    expect(cell(next, "stories", id, "entity")).toBe("Bus");
  });

  it("renames a page only this story uses, and leaves a shared one alone", () => {
    const placed = write(blank, "stories", id, "entity", "Depot");
    const next = write(placed, "stories", id, "path", "/yards");
    expect(next.screens.some((s) => s.path === "/depots")).toBe(false);
    expect(next.screens.find((s) => s.path === "/yards")!.stories).toEqual([id]);

    const joined = write(blank, "stories", id, "path", "/buses");
    const moved = write(joined, "stories", id, "path", "/elsewhere");
    expect(moved.screens.some((s) => s.path === "/buses")).toBe(true);
    expect(moved.screens.find((s) => s.path === "/elsewhere")!.stories).toEqual([id]);
  });

  it("takes a story off its page when Entity or Path is cleared", () => {
    const placed = write(blank, "stories", id, "entity", "Depot");
    expect(cell(write(placed, "stories", id, "path", ""), "stories", id, "path")).toBe("");
    expect(cell(write(placed, "stories", id, "entity", ""), "stories", id, "entity")).toBe("");
  });

  it("refuses a path without a slash, and a role that does not exist", () => {
    expect(() => cellToCommands(spec, "stories", spec.stories[0]!.id, "path", "buses")).toThrow(/starts with/);
    expect(() => cellToCommands(spec, "stories", spec.stories[0]!.id, "role", "Ghost")).toThrow(/no role/);
  });

  it("narrows the role list to the row's sub-project", () => {
    const grouped = run(spec, [{ type: "setSubProjects", subProjects: [{ name: "Driver app", roles: ["role:driver"] }] }]);
    const col = columnsOf(grouped, "stories").find((c) => c.key === "role")!;
    expect(col.options!({ id: "x", cells: { subProject: "Driver app" } })).toEqual(["Driver"]);
    expect(col.options!({ id: "x", cells: { subProject: "" } })).toEqual(grouped.roles.map((r) => r.name));
  });
});

describe("data model", () => {
  it("adds a table and its first field in one row", () => {
    const next = run(spec, createRow(spec, "data", { entity: "Depot", name: "Town", type: "text" })!);
    expect(next.entities.find((e) => e.name === "Depot")!.fields[0]!.name).toBe("Town");
  });

  it("shows a table with no fields, and adds its first field from that row", () => {
    const next = run(spec, createRow(spec, "data", { entity: "Depot" })!);
    expect(cell(next, "data", "entity:depot|", "entity")).toBe("Depot");
    expect(write(next, "data", "entity:depot|", "name", "Town").entities.at(-1)!.fields).toHaveLength(1);
  });

  it("renames a table from any of its rows", () => {
    const f = spec.entities[0]!.fields[0]!;
    expect(write(spec, "data", `entity:bus|${f.id}`, "entity", "Coach").entities[0]!.name).toBe("Coach");
  });

  it("gives a field what its new type needs, and drops what it no longer does", () => {
    const row = `entity:bus|${spec.entities[0]!.fields[0]!.id}`;
    const choice = write(spec, "data", row, "type", "choice");
    expect(cell(choice, "data", row, "options")).toBe("Option 1, Option 2");
    const back = write(choice, "data", row, "type", "text");
    expect(back.entities[0]!.fields[0]!.options).toBeUndefined();
    const ref = write(spec, "data", row, "type", "reference");
    expect(ref.entities[0]!.fields[0]!.references).toBe("entity:trip");
  });

  it("clears a min, max or default with an empty cell", () => {
    const row = `entity:bus|${spec.entities[0]!.fields[0]!.id}`;
    const set = write(spec, "data", row, "min", "2");
    expect(cell(set, "data", row, "min")).toBe("2");
    expect(cell(write(set, "data", row, "min", ""), "data", row, "min")).toBe("");
    expect(() => cellToCommands(spec, "data", row, "max", "lots")).toThrow(/must be a number/);
  });

  it("locks Options and Points at unless the type uses them", () => {
    const cols = columnsOf(spec, "data");
    const row = specToRows(spec, "data")[0]!;
    expect(cols.find((c) => c.key === "options")!.readOnly!(row)).toBe(true);
    expect(cols.find((c) => c.key === "references")!.readOnly!(row)).toBe(true);
  });
});

describe("screens and endpoints", () => {
  it("adds a screen from a title alone, and from a path alone", () => {
    expect(run(spec, createRow(spec, "screens", { title: "Reports" })!).screens.at(-1)!.path).toBe("/reports");
    expect(run(spec, createRow(spec, "screens", { path: "/depot" })!).screens.at(-1)!.title).toBe("depot");
  });

  it("gets Layout back to automatic", () => {
    const set = write(spec, "screens", "screen:trips", "layout", "board");
    expect(write(set, "screens", "screen:trips", "layout", "").screens.find((s) => s.id === "screen:trips")!.layout).toBeUndefined();
  });

  it("swaps fields and operations when a screen changes table", () => {
    const set = write(spec, "screens", "screen:buses", "fields", spec.entities[0]!.fields[0]!.name);
    const next = write(set, "screens", "screen:buses", "entity", "Trip");
    const s = next.screens.find((x) => x.id === "screen:buses")!;
    expect(s.fields).toEqual([]);
    expect(s.endpoints.every((e) => next.endpoints.find((x) => x.id === e)!.entity === "entity:trip")).toBe(true);
  });

  it("refuses a field from another table", () => {
    expect(() => cellToCommands(spec, "screens", "screen:buses", "fields", "Route")).toThrow(/no field called/);
  });

  it("attaches an endpoint to screens from its row", () => {
    const ep = spec.endpoints[0]!;
    const next = write(spec, "endpoints", ep.id, "screens", "Trips");
    expect(next.screens.find((s) => s.title === "Trips")!.endpoints).toContain(ep.id);
    expect(next.screens.filter((s) => s.endpoints.includes(ep.id))).toHaveLength(1);
  });

  it("needs an action for a custom endpoint, then adds it", () => {
    expect(createRow(spec, "endpoints", { entity: "Trip", operation: "custom" })).toBeNull();
    const next = run(spec, createRow(spec, "endpoints", { entity: "Trip", operation: "custom", action: "Assign driver" })!);
    expect(next.endpoints.at(-1)!.action).toBe("Assign driver");
  });

  it("links services to an endpoint by name", () => {
    const next = run(spec, createRow(spec, "services", { name: "Trip emails", kind: "email", secrets: "SMTP_URL" })!);
    const ep = spec.endpoints[0]!.id;
    expect(cell(write(next, "endpoint-services", ep, "services", "Trip emails"), "endpoint-services", ep, "services")).toBe("Trip emails");
    expect(() => cellToCommands(next, "endpoint-services", ep, "services", "Nope")).toThrow(/no service/);
  });
});

describe("sample rows", () => {
  const tab = tabIdForEntity("entity:bus");
  const plate = "field:plate";

  it("gives older rows an id the first time one is edited", () => {
    const [row] = specToRows(spec, tab);
    expect(row!.id).toBe("row-1");
    const next = write(spec, tab, "row-1", plate, "KA-99");
    expect(next.entities[0]!.seed[0]).toMatchObject({ id: "row-1", [plate]: "KA-99" });
  });

  it("adds a row, types its cells, and removes it", () => {
    const next = run(spec, createRow(spec, tab, { [plate]: "KA-02", "field:capacity": "32" })!);
    expect(next.entities[0]!.seed.at(-1)).toMatchObject({ [plate]: "KA-02", "field:capacity": 32 });
    const id = String(next.entities[0]!.seed.at(-1)!.id);
    expect(run(next, removeRow(next, tab, id)).entities[0]!.seed).toHaveLength(1);
  });

  it("refuses a value of the wrong kind", () => {
    expect(() => cellToCommands(spec, tab, "row-1", "field:capacity", "many")).toThrow(/must be a number/);
  });

  it("clears a cell by dropping the key, not by storing an empty value", () => {
    const next = write(spec, tab, "row-1", "field:capacity", "");
    expect(Object.keys(next.entities[0]!.seed[0]!)).not.toContain("field:capacity");
  });

  it("points a reference at a sample row by its name, and gives that row an id", () => {
    const trip = spec.entities.find((e) => e.fields.some((f) => f.references === "entity:bus"))!;
    const ref = trip.fields.find((f) => f.references === "entity:bus")!;
    const col = columnsOf(spec, tabIdForEntity(trip.id)).find((c) => c.key === ref.id)!;
    expect(col.options!(null)).toContain("KA-01-1234");
    const next = run(spec, createRow(spec, tabIdForEntity(trip.id), { [ref.id]: "KA-01-1234" })!);
    expect(next.entities.find((e) => e.id === trip.id)!.seed.at(-1)![ref.id]).toBe("row-1");
    expect(next.entities[0]!.seed[0]!.id).toBe("row-1");
  });
});

describe("moving rows", () => {
  it("reorders stories and fields, and only within a table", () => {
    const tabs = tabsFor(spec);
    const stories = tabs.find((t) => t.id === "stories")!;
    const data = tabs.find((t) => t.id === "data")!;
    expect(canReorder(stories)).toBe(true);
    expect(moveRow(stories, "story:a", "story:b")).toEqual([{ type: "moveItem", list: "stories", id: "story:a", before: "story:b" }]);
    expect(moveRow(data, "entity:a|field:x", "entity:a|field:y")).toEqual([{ type: "moveItem", list: "fields", entity: "entity:a", id: "field:x", before: "field:y" }]);
    expect(moveRow(data, "entity:a|field:x", "entity:b|field:y")).toEqual([]);
  });
});

describe("suggestions as ghost cells", () => {
  it("shows what a suggestion would change, new rows included, and where to go first", () => {
    const commands: Command[] = [
      { type: "addEntity", entity: { id: "entity:depot", name: "Depot", fields: [], relationships: [], seed: [] } },
      { type: "updateStory", id: spec.stories[0]!.id, patch: { reason: "so it is planned" } },
    ];
    const diff = ghostDiff(spec, run(spec, commands));
    expect(diff.first).toEqual({ tab: "stories", rowId: spec.stories[0]!.id, col: "reason" });
    expect(diff.cells.get(ghostKey("stories", spec.stories[0]!.id, "reason"))).toBe("so it is planned");
    expect(diff.rows.get("data")?.map((r) => r.id)).toEqual(["entity:depot|"]);
    expect(diff.cells.has(ghostKey("stories", spec.stories[1]!.id, "reason"))).toBe(false);
  });

  it("finds nothing when nothing changes", () => {
    const diff = ghostDiff(spec, spec);
    expect(diff.cells.size).toBe(0);
    expect(diff.first).toBeUndefined();
  });
});

describe("checks on cells", () => {
  it("flags a required cell left empty in a sample row, and says why", () => {
    const next = run(spec, [{ type: "setSeed", entity: "entity:bus", rows: [{ id: "r1" }] }]);
    const tab = tabIdForEntity("entity:bus");
    const flag = flagsFor(next, tab).get(flagKey("r1", "field:plate"));
    expect(flag?.level).toBe("bad");
    expect(flag?.why).toMatch(/required/i);
  });

  it("flags a story's role that is outside its sub-project", () => {
    const next = run(spec, [
      { type: "setSubProjects", subProjects: [{ name: "Driver app", roles: ["role:driver"] }] },
      { type: "updateStory", id: spec.stories.find((s) => s.role === "role:admin")!.id, patch: { subProject: "Driver app" } },
    ]);
    const id = spec.stories.find((s) => s.role === "role:admin")!.id;
    expect(flagsFor(next, "stories").get(flagKey(id, "role"))?.level).toBe("bad");
  });

  it("flags a story no page serves, and a role in more than one sub-project", () => {
    const orphan = run(spec, createRow(spec, "stories", { action: "track the fleet", role: "Admin" })!);
    expect(flagsFor(orphan, "stories").get(flagKey("story:track-the-fleet", "path"))?.level).toBe("warn");
    const twice = run(spec, [{ type: "setSubProjects", subProjects: [{ name: "A", roles: ["role:driver"] }, { name: "B", roles: ["role:driver"] }] }]);
    expect(flagsFor(twice, "roles").get(flagKey("role:driver", "subProjects"))?.level).toBe("warn");
  });

  it("flags two screens at one path", () => {
    const next = run(spec, createRow(spec, "screens", { title: "Again", path: "/buses" })!);
    expect(flagsFor(next, "screens").get(flagKey("screen:buses", "path"))?.level).toBe("bad");
  });
});
