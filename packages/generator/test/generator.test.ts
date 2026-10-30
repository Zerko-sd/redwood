import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand, checkSpec, type Spec } from "@redwood/spec";
import { DestructiveMigrationError, RegenerationRefused, checkRegistries, generate, registryProblems, writeApp } from "../src";

const spec = checkSpec(JSON.parse(readFileSync(new URL("../../../examples/bus-fleet.spec.json", import.meta.url), "utf8"))).spec!;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "redwood-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("determinism", () => {
  it("gives the same tree hash on every run", () => {
    const a = generate(spec);
    const b = generate(structuredClone(spec));
    expect(b.manifest.treeHash).toBe(a.manifest.treeHash);
    expect(Object.keys(a.files)).toEqual(Object.keys(b.files));
  });

  it("emits LF-only, sorted, newline-terminated files", () => {
    const { files } = generate(spec);
    expect(Object.keys(files)).toEqual([...Object.keys(files)].sort());
    for (const text of Object.values(files)) {
      expect(text).not.toContain("\r");
      expect(text.endsWith("\n")).toBe(true);
    }
  });

  it("changes the hash when the spec changes", () => {
    const next = applyCommand(spec, { type: "setTitle", title: "Other" });
    expect(generate(next).manifest.treeHash).not.toBe(generate(spec).manifest.treeHash);
  });
});

describe("output", () => {
  const { files, manifest } = generate(spec);

  it("compiles the access matrix into one policy used by API and UI", () => {
    const policy = files["src/shared/policy.ts"]!;
    expect(policy).toContain('"driver"');
    expect(policy).toContain('"owner": "driver"');
    expect(files["src/server/crud.ts"]).toContain("../shared/policy");
    expect(files["src/web/screens/Trips.tsx"]).toContain("../../shared/policy");
  });

  it("builds pages from the plan only", () => {
    expect(files["src/web/screens/Buses.tsx"]).not.toContain("StateButtons");
    expect(files["src/web/screens/Trips.tsx"]).toContain("StateButtons");
  });

  it("generates an access test case per role, table and operation", () => {
    const t = files["tests/access.test.ts"]!;
    expect(t).toContain('"driver": {');
    expect(t).toContain("row-level rules");
  });

  it("fingerprints every generated file and records kit gaps", () => {
    expect(Object.keys(manifest.files)).toContain("src/shared/policy.ts");
    expect(manifest.files["redwood.manifest.json"]).toBeUndefined();
    expect(manifest.kit.name).toBe("shadcn");
  });

  it("emits a placeholder for a part the kit lacks", () => {
    const noTable = { name: "tiny", version: "0", missing: ["Table" as const], dependencies: {}, files: () => ({ "index.ts": "", "components.tsx": "" }) };
    const r = generate(spec, { kit: noTable });
    expect(r.files["src/web/screens/Buses.tsx"]).toContain("<Placeholder");
    expect(r.manifest.needsDeveloper.some((g) => g.what === "screen:buses:Table")).toBe(true);
  });

  it("shows referenced records by name and offers a picker only through list access", () => {
    expect(files["src/shared/model.ts"]).toContain('"display": "plate"');
    const trips = files["src/web/screens/Trips.tsx"]!;
    expect(trips).toContain('useRecords("bus", can(me.role, "bus", "list"))');
    expect(trips).toContain("choices:");
    expect(files["src/web/screens/Buses.tsx"]).not.toContain("ref_");
    expect(files["src/server/crud.ts"]).toContain("refers to a record that does not exist");
  });

  it("gives every list a New action, a record page, a delete confirmation and honest empty states", () => {
    const buses = files["src/web/screens/Buses.tsx"]!;
    const record = files["src/web/screens/BusesRecord.tsx"]!;
    expect(buses).toContain('setEditing("new")');
    expect(buses).toContain('navigate("/buses" + "/" + row.id)');
    expect(record).toContain("<RecordPage");
    expect(record).toContain('"Delete " + nameOf(row)');
    expect(files["src/web/App.tsx"]).toContain("BusesRecord");
    expect(buses).toContain('title="Loading…"');
    expect(buses).toContain('title="No buses yet"');
    expect(buses).toContain("Add the first bus");
    expect(buses).toContain("As the Admin, I want to add, edit and remove buses.");
  });

  it("builds a home per role from its own stories, and records stories no screen serves", () => {
    expect(files["src/web/Home.tsx"]).toContain("add, edit and remove buses");
    const orphan = applyCommand(spec, {
      type: "addStory",
      story: { id: "story:orphan", role: "role:driver", action: "track the bus on a map", reason: "I can see delays" },
    });
    const r = generate(orphan);
    expect(r.files["src/web/Home.tsx"]).toContain("track the bus on a map");
    expect(r.manifest.needsDeveloper.some((g) => g.what === "story:orphan")).toBe(true);
  });

  it("shows a custom action as a button that opens a not-built-yet placeholder", () => {
    const next = applyCommand(
      applyCommand(spec, { type: "addEndpoint", endpoint: { id: "endpoint:assign", entity: "entity:trip", operation: "custom", action: "Assign Driver" } }),
      { type: "addScreen", screen: { id: "screen:dispatch", title: "Dispatch", path: "/dispatch", entity: "entity:trip", stories: ["story:schedule-trips"], endpoints: ["endpoint:trips-list", "endpoint:assign"], roles: ["role:admin"] } },
    );
    const page = generate(next).files["src/web/screens/Dispatch.tsx"]!;
    expect(page).toContain("Assign Driver");
    expect(page).toContain('"assign-driver"');
    expect(page).toContain('title="Not built yet"');
    expect(page).toContain("r.notBuilt");
  });

  it("replaces a part the kit lacks with a visible placeholder rather than omitting it", () => {
    const noDetail = { name: "tiny", version: "0", missing: ["RecordPage" as const, "Dialog" as const], dependencies: {}, files: () => ({ "index.ts": "", "components.tsx": "" }) };
    const r = generate(spec, { kit: noDetail });
    const buses = r.files["src/web/screens/Buses.tsx"]!;
    expect(buses).toContain('<Placeholder what="the record page on Buses" />');
    expect(buses).toContain('<Placeholder what="the dialog on Buses" />');
    expect(r.manifest.needsDeveloper.map((g) => g.what)).toEqual(expect.arrayContaining(["screen:buses:RecordPage", "screen:buses:Dialog"]));
  });

  it("adds the kit's own dependencies (fonts) to the app", () => {
    const pkg = JSON.parse(files["package.json"]!);
    expect(pkg.dependencies["@fontsource/hanken-grotesk"]).toBeTruthy();
    expect(files["src/web/ui/theme.css"]).toContain("@fontsource/source-serif-4/600.css");
  });

  it("stubs custom endpoints instead of guessing", () => {
    const next = applyCommand(spec, {
      type: "addEndpoint",
      endpoint: { id: "endpoint:assign", entity: "entity:trip", operation: "custom", action: "Assign Driver" },
    });
    const r = generate(next);
    expect(r.files["src/server/stubs.ts"]).toContain('"action": "assign-driver"');
    expect(r.manifest.needsDeveloper.some((g) => g.what === "endpoint:assign")).toBe(true);
  });
});

describe("layouts, themes and blocks", () => {
  const withTrips = (patch: object) => applyCommand(spec, { type: "updateScreen", id: "screen:trips", patch });

  it("has a renderer for every layout the closed list names", () => {
    expect(registryProblems()).toEqual([]);
  });

  it("renders a board for a screen that asks for one, with a column per workflow state", () => {
    const page = generate(withTrips({ layout: "board" })).files["src/web/screens/Trips.tsx"]!;
    expect(page).toContain("<Board");
    expect(page).toContain("model.workflow!.states.map");
    expect(page).not.toContain("<Table");
    expect(page).toContain('navigate("/trips" + "/" + row.id)'); // the shared blocks still compose in
  });

  it("refuses a layout that does not exist, or a board with no workflow behind it", () => {
    expect(() => generate(withTrips({ layout: "carousel" }))).toThrow(/unknown layout "carousel"/);
    const boardOnBuses = applyCommand(spec, { type: "updateScreen", id: "screen:buses", patch: { layout: "board" } });
    expect(() => generate(boardOnBuses)).toThrow(/needs an entity with a workflow/);
    expect(checkRegistries(boardOnBuses).map((i) => i.path)).toEqual(["screens.0.layout"]);
  });

  it("turns a create-only screen into a form page without being asked", () => {
    const next = applyCommand(spec, {
      type: "addScreen",
      screen: { id: "screen:new-bus", title: "Register a bus", path: "/register", entity: "entity:bus", stories: ["story:manage-buses"], endpoints: ["endpoint:buses-create"], roles: ["role:admin"] },
    });
    const page = generate(next).files["src/web/screens/NewBus.tsx"]!;
    expect(page).toContain("key={formKey}");
    expect(page).toContain('submitLabel="Create"');
    expect(page).not.toContain("<Table");
    expect(page).not.toContain("<Dialog");
  });

  it("applies a theme preset, and lets the spec override single tokens on top of it", () => {
    const harbor = structuredClone(spec);
    harbor.theme.preset = "harbor";
    expect(generate(harbor).files["src/web/ui/theme.css"]).toContain("--primary: #1d4673");
    harbor.theme.tokens = { primary: "#aa0000" };
    const css = generate(harbor).files["src/web/ui/theme.css"]!;
    expect(css).toContain("--primary: #aa0000");
    expect(css).not.toContain("#1d4673");
    const unknown = structuredClone(spec);
    unknown.theme.preset = "neon";
    expect(() => generate(unknown)).toThrow(/unknown theme "neon"/);
  });

  it("writes a developer file for a block it has no template for, and shows a placeholder meanwhile", () => {
    const r = generate(withTrips({ blocks: ["live-map"] }));
    const file = r.scaffold["custom/blocks/LiveMap.tsx"]!;
    expect(file).toContain("<Placeholder");
    expect(file).toContain("Redwood never overwrites this file");
    expect(file).toContain("As the Driver, I want to see my own trips");
    expect(r.files["src/web/screens/Trips.tsx"]).toContain('import LiveMap from "../../../custom/blocks/LiveMap"');
    expect(r.manifest.needsDeveloper).toContainEqual(expect.objectContaining({ what: "screen:trips:block:live-map", file: "custom/blocks/LiveMap.tsx" }));
  });

  it("keeps a developer's block, and stops reporting the gap once it no longer renders the placeholder", () => {
    const dir = tmp();
    const next = withTrips({ blocks: ["live-map"] });
    const first = writeApp(dir, next);
    expect(first.scaffolded).toContain("custom/blocks/LiveMap.tsx");
    expect(first.manifest.needsDeveloper.some((g) => g.what === "screen:trips:block:live-map")).toBe(true);

    const mine = 'export default function LiveMap() { return <div>my map</div>; }\n';
    writeFileSync(join(dir, "custom/blocks/LiveMap.tsx"), mine);
    const second = writeApp(dir, next);
    expect(readFileSync(join(dir, "custom/blocks/LiveMap.tsx"), "utf8")).toBe(mine);
    expect(second.manifest.needsDeveloper.some((g) => g.what === "screen:trips:block:live-map")).toBe(false);
  });
});

describe("record pages", () => {
  const record = (s: Spec, file = "Buses") => generate(s).files[`src/web/screens/${file}Record.tsx`]!;

  it("adds a tab for each table that points here, and only for roles that may list it", () => {
    const page = record(spec);
    expect(page).toContain('id: "trip"');
    expect(page).toContain('can(me.role, "trip", "list")');
    expect(page).toContain('navigate("/trips" + "/" + x.id)');
  });

  it("adds a Files tab only when the table holds files", () => {
    expect(record(spec)).not.toContain("RecordFiles");
    const withFile = applyCommand(spec, { type: "addField", entity: "entity:bus", field: { id: "field:photo", name: "Photo", type: "image", required: false, unique: false } });
    const page = record(withFile);
    expect(page).toContain("RecordFiles");
    expect(page).toContain('image={row["photo"]');
  });

  it("opens a form page for a role that may create but not list", () => {
    const next = applyCommand(spec, {
      type: "addScreen",
      screen: { id: "screen:new-bus", title: "Register a bus", path: "/register", entity: "entity:bus", stories: ["story:manage-buses"], endpoints: ["endpoint:buses-create"], roles: ["role:admin"] },
    });
    const { files: out } = generate(next);
    expect(out["src/web/App.tsx"]).toMatch(/path: "\/register".*op: "create" as const/);
    expect(out["src/web/App.tsx"]).toContain("can(me.role, s.table, s.op)");
    expect(out["src/web/App.tsx"]).toContain('can(me.role, s.table, "list") && <Count');
    expect(out["src/web/Home.tsx"]).toContain("can(me.role, sc.table, sc.op)");
  });

  it("gets no record page for a form-only screen", () => {
    const next = applyCommand(spec, {
      type: "addScreen",
      screen: { id: "screen:new-bus", title: "Register a bus", path: "/register", entity: "entity:bus", stories: ["story:manage-buses"], endpoints: ["endpoint:buses-create"], roles: ["role:admin"] },
    });
    expect(generate(next).files["src/web/screens/NewBusRecord.tsx"]).toBeUndefined();
  });

  it("honours what a screen shows, without widening past what a role may see", () => {
    const next = applyCommand(spec, { type: "updateScreen", id: "screen:buses", patch: { fields: ["field:plate"] } });
    const list = generate(next).files["src/web/screens/Buses.tsx"]!;
    expect(list).toContain('.filter((c) => ["plate"].includes(c.key))');
    expect(list.indexOf("!hidden.has(c.key)")).toBeLessThan(list.indexOf('["plate"]'));
  });

  it("puts a screen where its placement says", () => {
    const linked = generate(applyCommand(spec, { type: "updateScreen", id: "screen:buses", patch: { placement: "linked" } })).files["src/web/App.tsx"]!;
    expect(linked).toContain('placement: "linked"');
    expect(linked).toContain('s.placement !== "linked"');
    const home = generate(applyCommand(spec, { type: "updateScreen", id: "screen:buses", patch: { placement: "home" } })).files["src/web/App.tsx"]!;
    expect(home).toContain('placement: "home"');
    expect(home).toContain("<Navigate to={home.path} replace />");
  });

  it("groups the menu only when there is more than one sub-project", () => {
    const one = applyCommand(spec, { type: "updateScreen", id: "screen:buses", patch: { subProject: "Fleet" } });
    expect(generate(one).files["src/web/App.tsx"]).toContain('group: ""');
    const two = applyCommand(one, { type: "updateScreen", id: "screen:trips", patch: { subProject: "Trips" } });
    expect(generate(two).files["src/web/App.tsx"]).toContain('group: "Fleet"');
  });

  it("compiles read-only fields into the policy, and the server refuses a change to one", () => {
    const rule = spec.access.find((a) => a.entity === "entity:bus" && a.operations.includes("update"))!;
    const next = applyCommand(spec, { type: "grant", rule: { ...rule, readOnlyFields: ["Plate"] } });
    const { files } = generate(next);
    expect(files["src/shared/policy.ts"]).toContain('"readOnly": [\n');
    expect(files["src/shared/policy.ts"]).toContain("readOnlyColumns");
    expect(files["src/server/crud.ts"]).toContain("can't be changed");
    expect(files["src/web/screens/BusesRecord.tsx"]).toContain("readOnlyColumns(me.role");
  });

  it("emits sample rows with their own id, so references can point at them", () => {
    const next = applyCommand(spec, { type: "setSeed", entity: "entity:bus", rows: [{ id: "r1", "field:plate": "A" }] });
    expect(generate(next).files["src/shared/model.ts"]).toContain('"id": "r1"');
  });
});

describe("writing to disk", () => {
  it("refuses to overwrite a hand-edited generated file", () => {
    const dir = tmp();
    writeApp(dir, spec);
    writeFileSync(join(dir, "src/shared/policy.ts"), "// edited\n");
    expect(() => writeApp(dir, spec)).toThrow(RegenerationRefused);
    expect(() => writeApp(dir, spec, { force: true })).not.toThrow();
  });

  it("never touches developer files, and creates them once", () => {
    const dir = tmp();
    const first = writeApp(dir, spec);
    expect(first.scaffolded).toContain("custom/routes.ts");
    writeFileSync(join(dir, "custom/routes.ts"), "// mine\n");
    writeFileSync(join(dir, "custom/extra.ts"), "export {};\n");
    writeApp(dir, applyCommand(spec, { type: "setTitle", title: "Renamed App" }));
    expect(readFileSync(join(dir, "custom/routes.ts"), "utf8")).toBe("// mine\n");
    expect(existsSync(join(dir, "custom/extra.ts"))).toBe(true);
  });

  it("is a no-op when nothing changed", () => {
    const dir = tmp();
    writeApp(dir, spec);
    const again = writeApp(dir, spec);
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  it("removes generated files that are no longer produced", () => {
    const dir = tmp();
    writeApp(dir, spec);
    const r = writeApp(dir, applyCommand(spec, { type: "removeScreen", id: "screen:trips" }));
    expect(r.removed).toContain("src/web/screens/Trips.tsx");
    expect(existsSync(join(dir, "src/web/screens/Trips.tsx"))).toBe(false);
  });

  it("turns a screen whose entity was removed into a visible placeholder", () => {
    const dir = tmp();
    writeApp(dir, spec);
    const next = applyCommand(spec, { type: "removeEntity", id: "entity:trip" });
    const r = writeApp(dir, next, { allowDestructive: true });
    expect(readFileSync(join(dir, "src/web/screens/Trips.tsx"), "utf8")).toContain("<Placeholder");
    expect(r.manifest.needsDeveloper.some((g) => g.what === "screen:trips")).toBe(true);
  });
});

describe("migrations over time", () => {
  const migrations = (dir: string) => readdirSync(join(dir, "migrations")).sort();

  it("starts with auth + init, then appends and never rewrites", () => {
    const dir = tmp();
    writeApp(dir, spec);
    expect(migrations(dir)).toEqual(["0000_auth.sql", "0001_init.sql"]);
    const init = readFileSync(join(dir, "migrations/0001_init.sql"), "utf8");

    const renamed = applyCommand(spec, { type: "updateField", entity: "entity:bus", id: "field:plate", patch: { name: "Plate Number" } });
    writeApp(dir, renamed);
    const names = migrations(dir);
    expect(names).toHaveLength(3);
    expect(readFileSync(join(dir, "migrations/0001_init.sql"), "utf8")).toBe(init);
    expect(readFileSync(join(dir, `migrations/${names[2]}`), "utf8")).toContain('RENAME COLUMN "plate" TO "plate_number"');
  });

  it("rebuilds the schema when migrations are missing but the old spec copy is not", () => {
    const dir = tmp();
    writeApp(dir, spec);
    rmSync(join(dir, "migrations"), { recursive: true });
    writeApp(dir, spec);
    expect(migrations(dir)).toEqual(["0000_auth.sql", "0001_init.sql"]);
  });

  it("holds back data-losing changes until confirmed", () => {
    const dir = tmp();
    writeApp(dir, spec);
    const next: Spec = applyCommand(spec, { type: "removeField", entity: "entity:bus", id: "field:capacity" });
    expect(() => writeApp(dir, next)).toThrow(DestructiveMigrationError);
    expect(migrations(dir)).toHaveLength(2);
  });
});
