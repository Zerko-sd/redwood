import { LAYOUTS, PARTS, THEMES } from "@redwood/parts";
import { FIELD_TYPES, OPERATIONS, PLACEMENTS } from "@redwood/spec/src/schema";
import { freshId, slug, type Command, type Spec } from "../api";
import { SheetError, type Col, type Draft, type Row, type Tab } from "./defs";

type Entity = Spec["entities"][number];
type Field = Entity["fields"][number];
type Screen = Spec["screens"][number];
type Endpoint = Spec["endpoints"][number];
type FieldType = (typeof FIELD_TYPES)[number];
type Op = (typeof OPERATIONS)[number];

const PRIORITY = ["must", "should", "could"];
const STATUS = ["draft", "accepted", "built"];
const SERVICE_KINDS = ["email", "notification", "job", "storage", "audit", "integration"];
const CUSTOM = "custom";

/** Table sample rows live on their own tab each: `rows:<entity id>`. */
const ROWS = "rows:";

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const list = (text: string) => [...new Set(text.split(",").map((x) => x.trim()).filter(Boolean))];
const join = (items: readonly string[]) => items.join(", ");
const byName = <T extends { name: string }>(items: T[], name: string) => items.find((x) => norm(x.name) === norm(name));
const entityName = (spec: Spec, id?: string) => spec.entities.find((e) => e.id === id)?.name ?? "";
const roleName = (spec: Spec, id: string) => spec.roles.find((r) => r.id === id)?.name ?? id;
const yes = (v: unknown) => (v ? "Yes" : "");
const isYes = (s: string) => /^(y|yes|true|1|x)$/i.test(s.trim());
const humanPlural = (name: string) => (/s$/i.test(name) ? name : `${name}s`);
const defaultPath = (name: string) => `/${slug(humanPlural(name))}`;

function needRole(spec: Spec, name: string): string {
  const hit = byName(spec.roles, name);
  if (!hit) throw new SheetError(`There is no role called "${name}". Add it on Roles & Sub-Projects first.`);
  return hit.id;
}
function needEntity(spec: Spec, name: string): Entity {
  const hit = byName(spec.entities, name);
  if (!hit) throw new SheetError(`There is no table called "${name}". Add it on Data model first.`);
  return hit;
}
function needChoice(value: string, allowed: readonly string[], what: string): string {
  const hit = allowed.find((a) => norm(a) === norm(value));
  if (!hit) throw new SheetError(`${what} must be one of ${allowed.join(", ")}.`);
  return hit;
}
function number(value: string, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new SheetError(`${what} must be a number.`);
  return n;
}

// ------------------------------------------------------------------------------------------- shared moves

/** A screen over a table gets that table's CRUD operations, reusing any that already exist. */
function crud(spec: Spec, entityId: string): { commands: Command[]; ids: string[] } {
  const taken = spec.endpoints.map((e) => e.id);
  const commands: Command[] = [];
  const ids: string[] = [];
  for (const operation of OPERATIONS) {
    const have = spec.endpoints.find((e) => e.entity === entityId && e.operation === operation);
    if (have) { ids.push(have.id); continue; }
    const id = freshId("endpoint", `${slug(entityId.replace(/^entity:/, ""))}-${operation}`, taken);
    taken.push(id);
    ids.push(id);
    commands.push({ type: "addEndpoint", endpoint: { id, entity: entityId, operation, guards: [], services: [] } });
  }
  return { commands, ids };
}

function newScreen(spec: Spec, title: string, path: string, entity: string | undefined, stories: string[]): Command[] {
  const made = entity ? crud(spec, entity) : { commands: [], ids: [] };
  return [
    ...made.commands,
    {
      type: "addScreen",
      screen: {
        id: freshId("screen", title, spec.screens.map((s) => s.id)), title, path,
        ...(entity ? { entity } : {}),
        stories, endpoints: made.ids, blocks: [], bento: {}, roles: [], fields: [], placement: "nav",
      },
    },
  ];
}

const screensOf = (spec: Spec, storyId: string) => spec.screens.filter((s) => s.stories.includes(storyId));

/**
 * Entity and Path on a story are not stored on it: a story lives wherever a screen holds it. This puts it there,
 * reusing the page at that path, renaming a page only this story uses, and adding the table if it is new.
 */
function placeStory(spec: Spec, storyId: string, want: { entity?: string; path?: string }): Command[] {
  const current = screensOf(spec, storyId)[0];
  const entityText = want.entity ?? entityName(spec, current?.entity);
  const pathText = want.path ?? current?.path ?? "";

  // Clearing either one is how a person says "this story isn't placed yet".
  if (want.entity === "" || want.path === "" || (!entityText && !pathText)) {
    return current ? [{ type: "updateScreen", id: current.id, patch: { stories: current.stories.filter((x) => x !== storyId) } }] : [];
  }
  if (pathText && !pathText.startsWith("/")) throw new SheetError('A path starts with "/", for example /buses.');

  const commands: Command[] = [];
  let entityId: string | undefined;
  if (entityText) {
    const hit = byName(spec.entities, entityText);
    entityId = hit?.id ?? freshId("entity", entityText, spec.entities.map((e) => e.id));
    if (!hit) commands.push({ type: "addEntity", entity: { id: entityId, name: entityText.trim(), fields: [], relationships: [], seed: [] } });
  }

  const entityChanged = want.entity !== undefined && entityId !== current?.entity;
  const path = want.path ?? (entityChanged || !current ? defaultPath(entityText) : current.path);
  const target = spec.screens.find((s) => s.path === path);

  if (target) {
    if (target.id !== current?.id) {
      if (current) commands.push({ type: "updateScreen", id: current.id, patch: { stories: current.stories.filter((x) => x !== storyId) } });
      commands.push({ type: "updateScreen", id: target.id, patch: { stories: [...target.stories, storyId], ...(target.entity || !entityId ? {} : { entity: entityId }) } });
    }
    if (target.id === current?.id && entityChanged && entityId) commands.push(...retarget(spec, target, entityId));
    return commands;
  }

  if (current && current.stories.length === 1) {
    commands.push({ type: "updateScreen", id: current.id, patch: { path } });
    if (entityChanged && entityId) commands.push(...retarget(spec, current, entityId));
    return commands;
  }
  if (current) commands.push({ type: "updateScreen", id: current.id, patch: { stories: current.stories.filter((x) => x !== storyId) } });
  const title = entityText ? humanPlural(entityText.trim()) : path.slice(1) || "Home";
  commands.push(...newScreen(spec, title, path, entityId, [storyId]));
  return commands;
}

/** Points a screen at another table. Its visible fields and operations belonged to the old one. */
function retarget(spec: Spec, screen: Screen, entityId: string): Command[] {
  const made = crud(spec, entityId);
  return [...made.commands, { type: "updateScreen", id: screen.id, patch: { entity: entityId, endpoints: made.ids, fields: [] } }];
}

/** What a field's type needs beside its name, so a change of type never leaves it invalid. */
function typePatch(spec: Spec, entity: Entity, type: FieldType, current: Partial<Field>): Partial<Field> {
  if (type === "reference") {
    const target = current.references ?? spec.entities.find((e) => e.id !== entity.id)?.id;
    if (!target) throw new SheetError("Add another table first, to point the reference at.");
    return { type, references: target };
  }
  if (type === "choice") return { type, options: current.options?.length ? current.options : ["Option 1", "Option 2"] };
  return { type };
}

function setSubProjectsOf(spec: Spec, roleId: string, names: string[]): Command {
  const kept = spec.subProjects
    .map((sp) => ({ ...sp, roles: sp.roles.filter((r) => r !== roleId) }))
    .filter((sp) => sp.roles.length || names.some((n) => norm(n) === norm(sp.name)));
  for (const n of names) {
    const hit = byName(kept, n);
    if (hit) hit.roles.push(roleId);
    else kept.push({ name: n, roles: [roleId] });
  }
  return { type: "setSubProjects", subProjects: kept };
}

// ---------------------------------------------------------------------------------------------- sample rows

/** The field that names a row in dropdowns, picked the way the generator picks a record's name. */
export function displayField(e: Entity): Field | undefined {
  return e.fields.find((x) => x.type === "text" && x.required) ?? e.fields.find((x) => x.type === "text") ?? e.fields[0];
}

/** Older rows have no id of their own. They get one the first time something writes to the table. */
function withIds(e: Entity): Entity["seed"] {
  const used = new Set(e.seed.flatMap((r) => (typeof r.id === "string" ? [r.id] : [])));
  return e.seed.map((r, i) => {
    if (typeof r.id === "string") return r;
    let id = `row-${i + 1}`;
    while (used.has(id)) id += "x";
    used.add(id);
    return { ...r, id };
  });
}
const seedLabel = (e: Entity, row: Entity["seed"][number]): string => {
  const f = displayField(e);
  return f && row[f.id] != null ? String(row[f.id]) : String(row.id);
};
const needsIds = (e: Entity) => e.seed.some((r) => typeof r.id !== "string");
const newRowId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function seedCell(spec: Spec, e: Entity, f: Field, value: string): { value: string | number | boolean | null; before: Command[] } {
  if (!value.trim()) return { value: null, before: [] };
  switch (f.type) {
    case "number": case "money": case "percent": case "rating": return { value: number(value, f.name), before: [] };
    case "boolean": return { value: isYes(value), before: [] };
    case "choice": return { value: needChoice(value, f.options ?? [], f.name), before: [] };
    case "reference": {
      const target = spec.entities.find((x) => x.id === f.references);
      if (!target) return { value: null, before: [] };
      const rows = withIds(target);
      const hit = rows.find((r) => norm(seedLabel(target, r)) === norm(value));
      if (!hit) throw new SheetError(`${target.name} has no sample row called "${value}".`);
      return { value: hit.id as string, before: needsIds(target) ? [{ type: "setSeed", entity: target.id, rows }] : [] };
    }
    default: return { value: value.trim(), before: [] };
  }
}

function seedPatch(spec: Spec, e: Entity, values: Draft): { patch: Record<string, string | number | boolean | null>; before: Command[] } {
  const patch: Record<string, string | number | boolean | null> = {};
  const before: Command[] = [];
  for (const [key, text] of Object.entries(values)) {
    const f = e.fields.find((x) => x.id === key);
    if (!f) continue;
    const cell = seedCell(spec, e, f, text);
    patch[key] = cell.value;
    before.push(...cell.before);
  }
  return { patch, before };
}
const drop = <T extends object>(row: T): T => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as T;

// ---------------------------------------------------------------------------------------------- the tabs

const WORK: Tab[] = [
  { id: "roles", name: "Roles & Sub-Projects", group: "work", rows: true, order: { list: "roles" } },
  { id: "stories", name: "Stories", group: "work", rows: true, order: { list: "stories" } },
  { id: "data", name: "Data model", group: "work", rows: true },
  { id: "screens", name: "Screens", group: "work", rows: true, order: { list: "screens" } },
  { id: "endpoints", name: "Endpoints", group: "work", rows: true, order: { list: "endpoints" } },
  { id: "endpoint-services", name: "Endpoint Services", group: "work", rows: false },
];
const FIXED: Tab[] = [
  { id: "list-roles", name: "Roles", group: "lists", rows: false, fixed: true },
  { id: "list-subprojects", name: "Sub Projects", group: "lists", rows: false, fixed: true },
  { id: "list-entities", name: "Entity", group: "lists", rows: false, fixed: true },
  { id: "lib-layouts", name: "Layouts & parts", group: "library", rows: false, fixed: true },
  { id: "lib-endpoints", name: "Endpoint Templates", group: "library", rows: false, fixed: true },
  { id: "services", name: "Service Templates", group: "library", rows: true, order: { list: "services" } },
];

export function tabsFor(spec: Spec): Tab[] {
  return [...WORK, ...FIXED, ...spec.entities.map((e): Tab => ({ id: `${ROWS}${e.id}`, name: e.name, group: "rows", rows: true }))];
}
export const tabIdForEntity = (id: string) => `${ROWS}${id}`;
const rowsEntity = (spec: Spec, tab: string): Entity | undefined => spec.entities.find((e) => `${ROWS}${e.id}` === tab);

const roleOptions = (spec: Spec) => spec.roles.map((r) => r.name);
const entityOptions = (spec: Spec) => spec.entities.map((e) => e.name);
const subProjectOptions = (spec: Spec) => spec.subProjects.map((s) => s.name);

const hostScreens = (spec: Spec, ep: Endpoint) => spec.screens.filter((s) => s.endpoints.includes(ep.id));
const endpointLabel = (spec: Spec, ep: Endpoint) => `${entityName(spec, ep.entity)} · ${ep.operation === CUSTOM ? ep.action : ep.operation}`;

export function columnsOf(spec: Spec, tab: string): Col[] {
  const fieldsOf = (row: Row | null) => spec.entities.find((e) => norm(e.name) === norm(row?.cells.entity ?? ""))?.fields.map((f) => f.name) ?? [];
  switch (tab) {
    case "roles": return [
      { key: "name", header: "Role", type: "text", width: 200, required: true, hint: "e.g. Driver" },
      { key: "subProjects", header: "Sub Projects", type: "tags", width: 240, free: true, options: () => subProjectOptions(spec), hint: "e.g. Driver app" },
      { key: "description", header: "Description", type: "text", width: 380 },
    ];
    case "stories": return [
      { key: "subProject", header: "Sub Project", type: "enum", width: 150, options: () => ["", ...subProjectOptions(spec)] },
      {
        key: "role", header: "Role", type: "enum", width: 130, required: true,
        // Within a sub-project, only the roles that work in it.
        options: (row) => {
          const sp = byName(spec.subProjects, row?.cells.subProject ?? "");
          return sp?.roles.length ? sp.roles.map((r) => roleName(spec, r)) : roleOptions(spec);
        },
      },
      { key: "action", header: "Story", type: "text", width: 380, required: true, hint: "I want to book a class" },
      { key: "reason", header: "So that", type: "text", width: 240 },
      { key: "entity", header: "Entity", type: "enum", width: 140, free: true, options: () => ["", ...entityOptions(spec)] },
      { key: "path", header: "Path", type: "text", width: 150, hint: "/buses" },
      { key: "priority", header: "Priority", type: "enum", width: 90, options: () => PRIORITY },
      { key: "status", header: "Status", type: "enum", width: 100, options: () => STATUS },
    ];
    case "data": return [
      { key: "entity", header: "Entity", type: "text", width: 150, required: true, hint: "e.g. Bus" },
      { key: "name", header: "Field", type: "text", width: 180, required: true, hint: "Add a field" },
      { key: "type", header: "Type", type: "enum", width: 110, options: () => [...FIELD_TYPES] },
      { key: "required", header: "Required", type: "bool", width: 76 },
      { key: "unique", header: "Unique", type: "bool", width: 70 },
      { key: "default", header: "Default", type: "text", width: 100 },
      { key: "min", header: "Min", type: "number", width: 70 },
      { key: "max", header: "Max", type: "number", width: 70 },
      { key: "options", header: "Options", type: "tags", width: 220, free: true, readOnly: (r) => r.cells.type !== "choice", hint: "for a choice" },
      { key: "references", header: "Points at", type: "enum", width: 130, options: () => entityOptions(spec), readOnly: (r) => r.cells.type !== "reference" },
    ];
    case "screens": return [
      { key: "subProject", header: "Sub Project", type: "enum", width: 140, options: () => ["", ...subProjectOptions(spec)] },
      { key: "path", header: "Path", type: "text", width: 150, required: true, hint: "/buses" },
      { key: "title", header: "Title", type: "text", width: 170, required: true },
      { key: "entity", header: "Entity", type: "enum", width: 130, options: () => ["", ...entityOptions(spec)] },
      { key: "layout", header: "Layout", type: "enum", width: 110, options: () => ["", ...Object.keys(LAYOUTS)], hint: "automatic" },
      { key: "fields", header: "Fields", type: "tags", width: 240, options: fieldsOf, hint: "all of them" },
      { key: "placement", header: "Placement", type: "enum", width: 100, options: () => [...PLACEMENTS] },
      { key: "roles", header: "Audience", type: "tags", width: 190, options: () => roleOptions(spec), hint: "everyone" },
      { key: "stories", header: "Stories", type: "number", width: 70, readOnly: () => true },
    ];
    case "endpoints": return [
      { key: "subProject", header: "Sub Project", type: "enum", width: 140, options: () => ["", ...subProjectOptions(spec)] },
      { key: "entity", header: "Entity", type: "enum", width: 140, required: true, options: () => entityOptions(spec) },
      { key: "operation", header: "Operation", type: "enum", width: 110, required: true, options: () => [...OPERATIONS, CUSTOM] },
      { key: "action", header: "Custom action", type: "text", width: 200, readOnly: (r) => r.cells.operation !== CUSTOM, hint: "for a custom one" },
      { key: "screens", header: "Screens", type: "tags", width: 220, options: () => spec.screens.map((s) => s.title) },
      { key: "guards", header: "Guards", type: "tags", width: 200, free: true },
    ];
    case "endpoint-services": return [
      { key: "endpoint", header: "Endpoint", type: "text", width: 240, readOnly: () => true },
      { key: "services", header: "Services", type: "tags", width: 300, options: () => spec.services.map((s) => s.name), hint: "none" },
    ];
    case "services": return [
      { key: "name", header: "Service", type: "text", width: 220, required: true, hint: "e.g. Trip emails" },
      { key: "kind", header: "Kind", type: "enum", width: 130, options: () => SERVICE_KINDS },
      { key: "secrets", header: "Secrets it expects", type: "tags", width: 320, free: true, hint: "names only, never values" },
    ];
    case "list-roles": return [{ key: "name", header: "Role", type: "text", width: 240, readOnly: () => true }];
    case "list-subprojects": return [{ key: "name", header: "Sub Project", type: "text", width: 240, readOnly: () => true }];
    case "list-entities": return [{ key: "name", header: "Entity", type: "text", width: 240, readOnly: () => true }];
    case "lib-layouts": return [
      { key: "kind", header: "Kind", type: "text", width: 110, readOnly: () => true },
      { key: "name", header: "Name", type: "text", width: 170, readOnly: () => true },
      { key: "description", header: "What it does", type: "text", width: 560, readOnly: () => true },
    ];
    case "lib-endpoints": return [
      { key: "name", header: "Operation", type: "text", width: 120, readOnly: () => true },
      { key: "method", header: "Method", type: "text", width: 90, readOnly: () => true },
      { key: "path", header: "Path pattern", type: "text", width: 200, readOnly: () => true },
      { key: "description", header: "Description", type: "text", width: 380, readOnly: () => true },
    ];
  }
  const e = rowsEntity(spec, tab);
  if (!e) return [];
  return e.fields.map((f): Col => {
    const base = { key: f.id, header: f.name, width: 160, required: f.required };
    switch (f.type) {
      case "boolean": return { ...base, type: "bool", width: 90 };
      case "number": case "money": case "percent": case "rating": return { ...base, type: "number", width: 110 };
      case "longtext": return { ...base, type: "longtext", width: 260 };
      case "choice": return { ...base, type: "enum", options: () => ["", ...(f.options ?? [])] };
      case "reference": {
        const target = spec.entities.find((x) => x.id === f.references);
        return { ...base, type: "enum", options: () => ["", ...(target ? withIds(target).map((r) => seedLabel(target, r)) : [])] };
      }
      case "date": return { ...base, type: "text", hint: "2026-01-31" };
      case "datetime": return { ...base, type: "text", width: 180, hint: "2026-01-31T09:00" };
      default: return { ...base, type: "text" };
    }
  });
}

export function specToRows(spec: Spec, tab: string): Row[] {
  switch (tab) {
    case "roles": return spec.roles.map((r) => ({
      id: r.id,
      cells: { name: r.name, subProjects: join(spec.subProjects.filter((s) => s.roles.includes(r.id)).map((s) => s.name)), description: r.description },
    }));
    case "stories": return spec.stories.map((s) => {
      const screen = screensOf(spec, s.id)[0];
      return {
        id: s.id,
        cells: {
          subProject: s.subProject ?? "", role: roleName(spec, s.role), action: s.action, reason: s.reason,
          entity: entityName(spec, screen?.entity), path: screen?.path ?? "", priority: s.priority, status: s.status,
        },
      };
    });
    case "data": return spec.entities.flatMap((e): Row[] => {
      if (!e.fields.length) return [{ id: `${e.id}|`, cells: { entity: e.name, name: "", type: "", required: "", unique: "", default: "", min: "", max: "", options: "", references: "" } }];
      return e.fields.map((f) => ({
        id: `${e.id}|${f.id}`,
        cells: {
          entity: e.name, name: f.name, type: f.type, required: yes(f.required), unique: yes(f.unique),
          default: f.default === undefined ? "" : String(f.default), min: f.min === undefined ? "" : String(f.min), max: f.max === undefined ? "" : String(f.max),
          options: join(f.options ?? []), references: entityName(spec, f.references),
        },
      }));
    });
    case "screens": return spec.screens.map((s) => ({
      id: s.id,
      cells: {
        subProject: s.subProject ?? "", path: s.path, title: s.title, entity: entityName(spec, s.entity), layout: s.layout ?? "",
        fields: join(s.fields.map((f) => spec.entities.find((e) => e.id === s.entity)?.fields.find((x) => x.id === f)?.name ?? f)),
        placement: s.placement, roles: join(s.roles.map((r) => roleName(spec, r))), stories: String(s.stories.length),
      },
    }));
    case "endpoints": return spec.endpoints.map((ep) => ({
      id: ep.id,
      cells: {
        subProject: ep.subProject ?? "", entity: entityName(spec, ep.entity), operation: ep.operation, action: ep.action ?? "",
        screens: join(hostScreens(spec, ep).map((s) => s.title)), guards: join(ep.guards),
      },
    }));
    case "endpoint-services": return spec.endpoints.map((ep) => ({
      id: ep.id,
      cells: { endpoint: endpointLabel(spec, ep), services: join(ep.services.map((x) => spec.services.find((s) => s.id === x)?.name ?? x)) },
    }));
    case "services": return spec.services.map((s) => ({ id: s.id, cells: { name: s.name, kind: s.kind, secrets: join(s.secrets) } }));
    case "list-roles": return spec.roles.map((r) => ({ id: r.id, cells: { name: r.name } }));
    case "list-subprojects": return spec.subProjects.map((s) => ({ id: s.name, cells: { name: s.name } }));
    case "list-entities": return spec.entities.map((e) => ({ id: e.id, cells: { name: e.name } }));
    case "lib-layouts": return [
      ...Object.entries(LAYOUTS).map(([name, description]) => ({ id: `layout:${name}`, cells: { kind: "Layout", name, description } })),
      ...PARTS.map((name) => ({ id: `part:${name}`, cells: { kind: "Part", name, description: PART_NOTES[name] ?? "" } })),
      ...[...new Set(spec.screens.flatMap((s) => s.blocks))].map((name) => ({ id: `block:${name}`, cells: { kind: "Named block", name, description: "Named by a screen here. A developer builds it unless a template exists." } })),
      ...Object.entries(THEMES).map(([name, t]) => ({ id: `theme:${name}`, cells: { kind: "Theme", name, description: t.description } })),
    ];
    case "lib-endpoints": return OPERATIONS.map((op) => ({ id: op, cells: { name: op, ...REST[op] } }));
  }
  const e = rowsEntity(spec, tab);
  if (!e) return [];
  return withIds(e).map((r) => ({
    id: String(r.id),
    cells: Object.fromEntries(e.fields.map((f) => [f.id, seedText(spec, f, r[f.id])])),
  }));
}

function seedText(spec: Spec, f: Field, v: unknown): string {
  if (v === undefined || v === null) return "";
  if (f.type === "boolean") return yes(v);
  if (f.type === "reference") {
    const target = spec.entities.find((x) => x.id === f.references);
    const row = target && withIds(target).find((r) => r.id === v);
    return target && row ? seedLabel(target, row) : String(v);
  }
  return String(v);
}

const REST: Record<Op, { method: string; path: string; description: string }> = {
  list: { method: "GET", path: "/api/<table>", description: "All the records this role may see." },
  read: { method: "GET", path: "/api/<table>/:id", description: "One record." },
  create: { method: "POST", path: "/api/<table>", description: "Adds a record." },
  update: { method: "PATCH", path: "/api/<table>/:id", description: "Changes a record." },
  delete: { method: "DELETE", path: "/api/<table>/:id", description: "Removes a record, unless other records still use it." },
};
const PART_NOTES: Partial<Record<(typeof PARTS)[number], string>> = {
  Page: "The header every screen has.", Toolbar: "Search and the record count.", Table: "Records in rows.",
  Board: "Cards in one column per workflow state.", Form: "Creates or edits a record.", RecordPage: "One record on its own page, with tabs.",
  Tabs: "Switches between views of one record.", StatCards: "A line of totals.", Dialog: "Confirmations and forms over the page.",
  EmptyState: "What shows when there is nothing yet.", StateButtons: "Moves a record through its workflow.",
  SearchBox: "Filters a list.", Button: "An action.", Notifications: "Short messages after an action.", StoryList: "A role's own stories, on Home.",
};

// ---------------------------------------------------------------------------------------------- writing

/** One changed cell, as spec commands. Throws a SheetError with a sentence for the person when it can't be done. */
export function cellToCommands(spec: Spec, tab: string, rowId: string, col: string, raw: string): Command[] {
  const value = raw.trim();
  switch (tab) {
    case "roles": {
      if (col === "name") return value ? [{ type: "updateRole", id: rowId, patch: { name: value } }] : [];
      if (col === "description") return [{ type: "updateRole", id: rowId, patch: { description: value } }];
      if (col === "subProjects") return [setSubProjectsOf(spec, rowId, list(value))];
      return [];
    }
    case "stories": {
      if (col === "entity") return placeStory(spec, rowId, { entity: value });
      if (col === "path") return placeStory(spec, rowId, { path: value });
      if (col === "subProject") return [value ? { type: "updateStory", id: rowId, patch: { subProject: value } } : { type: "updateStory", id: rowId, patch: {}, clear: ["subProject"] }];
      if (col === "role") return value ? [{ type: "updateStory", id: rowId, patch: { role: needRole(spec, value) } }] : [];
      if (col === "action") return value ? [{ type: "updateStory", id: rowId, patch: { action: value } }] : [];
      if (col === "reason") return [{ type: "updateStory", id: rowId, patch: { reason: value } }];
      if (col === "priority") return [{ type: "updateStory", id: rowId, patch: { priority: needChoice(value, PRIORITY, "Priority") as "must" } }];
      if (col === "status") return [{ type: "updateStory", id: rowId, patch: { status: needChoice(value, STATUS, "Status") as "draft" } }];
      return [];
    }
    case "data": return dataCell(spec, rowId, col, value);
    case "screens": {
      const screen = spec.screens.find((s) => s.id === rowId);
      if (!screen) return [];
      const shown = spec.entities.find((e) => e.id === screen.entity);
      if (col === "path") {
        if (!value) return [];
        if (!value.startsWith("/")) throw new SheetError('A path starts with "/", for example /buses.');
        return [{ type: "updateScreen", id: rowId, patch: { path: value } }];
      }
      if (col === "title") return value ? [{ type: "updateScreen", id: rowId, patch: { title: value } }] : [];
      if (col === "subProject") return [value ? { type: "updateScreen", id: rowId, patch: { subProject: value } } : { type: "updateScreen", id: rowId, patch: {}, clear: ["subProject"] }];
      if (col === "layout") return [value ? { type: "updateScreen", id: rowId, patch: { layout: needChoice(value, Object.keys(LAYOUTS), "Layout") } } : { type: "updateScreen", id: rowId, patch: {}, clear: ["layout"] }];
      if (col === "placement") return [{ type: "updateScreen", id: rowId, patch: { placement: needChoice(value, PLACEMENTS, "Placement") as "nav" } }];
      if (col === "entity") {
        if (!value) return [{ type: "updateScreen", id: rowId, patch: { endpoints: [], fields: [] }, clear: ["entity"] }];
        return retarget(spec, screen, needEntity(spec, value).id);
      }
      if (col === "roles") return [{ type: "updateScreen", id: rowId, patch: { roles: list(value).map((n) => needRole(spec, n)) } }];
      if (col === "fields") {
        const ids = list(value).map((n) => {
          const f = shown ? byName(shown.fields, n) : undefined;
          if (!f) throw new SheetError(`${shown?.name ?? "This screen's table"} has no field called "${n}".`);
          return f.id;
        });
        return [{ type: "updateScreen", id: rowId, patch: { fields: ids } }];
      }
      return [];
    }
    case "endpoints": {
      const ep = spec.endpoints.find((x) => x.id === rowId);
      if (!ep) return [];
      if (col === "subProject") return [value ? { type: "updateEndpoint", id: rowId, patch: { subProject: value } } : { type: "updateEndpoint", id: rowId, patch: {}, clear: ["subProject"] }];
      if (col === "entity") return value ? [{ type: "updateEndpoint", id: rowId, patch: { entity: needEntity(spec, value).id } }] : [];
      if (col === "operation") {
        const operation = needChoice(value, [...OPERATIONS, CUSTOM], "Operation") as Op | "custom";
        if (operation === CUSTOM) return [{ type: "updateEndpoint", id: rowId, patch: { operation, action: ep.action ?? "New action" } }];
        return [{ type: "updateEndpoint", id: rowId, patch: { operation }, clear: ["action"] }];
      }
      if (col === "action") return value ? [{ type: "updateEndpoint", id: rowId, patch: { action: value } }] : [];
      if (col === "guards") return [{ type: "updateEndpoint", id: rowId, patch: { guards: list(value) } }];
      if (col === "screens") {
        const want = new Set(list(value).map(norm));
        for (const n of want) if (!spec.screens.some((s) => norm(s.title) === n)) throw new SheetError(`There is no screen called "${n}".`);
        return spec.screens.flatMap((s): Command[] => {
          const has = s.endpoints.includes(rowId);
          const should = want.has(norm(s.title));
          if (has === should) return [];
          return [{ type: "updateScreen", id: s.id, patch: { endpoints: should ? [...s.endpoints, rowId] : s.endpoints.filter((x) => x !== rowId) } }];
        });
      }
      return [];
    }
    case "endpoint-services": {
      if (col !== "services") return [];
      const ids = list(value).map((n) => {
        const hit = byName(spec.services, n);
        if (!hit) throw new SheetError(`There is no service called "${n}". Add it on Service Templates first.`);
        return hit.id;
      });
      return [{ type: "updateEndpoint", id: rowId, patch: { services: ids } }];
    }
    case "services": {
      if (col === "name") return value ? [{ type: "updateService", id: rowId, patch: { name: value } }] : [];
      if (col === "kind") return [{ type: "updateService", id: rowId, patch: { kind: needChoice(value, SERVICE_KINDS, "Kind") as "email" } }];
      if (col === "secrets") return [{ type: "updateService", id: rowId, patch: { secrets: list(value) } }];
      return [];
    }
  }
  const e = rowsEntity(spec, tab);
  if (!e) return [];
  const rows = withIds(e);
  const row = rows.find((r) => r.id === rowId);
  if (!row) return [];
  const { patch, before } = seedPatch(spec, e, { [col]: value });
  const seed: Command[] = needsIds(e) ? [{ type: "setSeed", entity: e.id, rows }] : [];
  return [...before, ...seed, { type: "putSeedRow", entity: e.id, row: drop({ ...row, ...patch }) as { id: string } }];
}

function dataCell(spec: Spec, rowId: string, col: string, value: string): Command[] {
  const [entityId, fieldId] = rowId.split("|") as [string, string];
  const e = spec.entities.find((x) => x.id === entityId);
  if (!e) return [];
  if (col === "entity") return value ? [{ type: "updateEntity", id: e.id, patch: { name: value } }] : [];

  const f = e.fields.find((x) => x.id === fieldId);
  if (!f) {
    if (col !== "name" || !value) return [];
    return [{ type: "addField", entity: e.id, field: { id: freshId("field", value, e.fields.map((x) => x.id)), name: value, type: "text", required: false, unique: false } }];
  }
  const update = (patch: Partial<Field>, clear?: string[]): Command[] => [{ type: "updateField", entity: e.id, id: f.id, patch, ...(clear ? { clear } : {}) } as Command];
  switch (col) {
    case "name": return value ? update({ name: value }) : [];
    case "type": {
      const type = needChoice(value, FIELD_TYPES, "Type") as FieldType;
      const stale = [...(type === "reference" ? [] : ["references"]), ...(type === "choice" ? [] : ["options"])];
      return update(typePatch(spec, e, type, f), stale);
    }
    case "required": return update({ required: isYes(value) });
    case "unique": return update({ unique: isYes(value) });
    case "min": case "max": return value ? update({ [col]: number(value, col === "min" ? "Min" : "Max") }) : update({}, [col]);
    case "default": {
      if (!value) return update({}, ["default"]);
      const numeric = ["number", "money", "percent", "rating"].includes(f.type);
      return update({ default: numeric ? number(value, "Default") : f.type === "boolean" ? isYes(value) : value });
    }
    case "options": return update({ options: list(value) });
    case "references": return value ? update({ references: needEntity(spec, value).id }) : [];
    default: return [];
  }
}

/** Commands for a new row, or null while it is still missing what it needs. */
export function createRow(spec: Spec, tab: string, draft: Draft): Command[] | null {
  const text = (k: string) => (draft[k] ?? "").trim();
  switch (tab) {
    case "roles": {
      if (!text("name")) return null;
      const id = freshId("role", text("name"), spec.roles.map((r) => r.id));
      const out: Command[] = [{ type: "addRole", role: { id, name: text("name"), description: text("description") } }];
      if (text("subProjects")) out.push(setSubProjectsOf(spec, id, list(text("subProjects"))));
      return out;
    }
    case "stories": {
      if (!text("action")) return null;
      const role = text("role") ? needRole(spec, text("role")) : spec.roles[0]?.id;
      if (!role) throw new SheetError("Add a role first, on Roles & Sub-Projects.");
      const id = freshId("story", text("action"), spec.stories.map((s) => s.id));
      const story = {
        id, role, action: text("action"), reason: text("reason"), acceptance: [], tags: [], origin: "human" as const,
        priority: (text("priority") ? needChoice(text("priority"), PRIORITY, "Priority") : "should") as "should",
        status: (text("status") ? needChoice(text("status"), STATUS, "Status") : "accepted") as "accepted",
        ...(text("subProject") ? { subProject: text("subProject") } : {}),
      };
      const out: Command[] = [{ type: "addStory", story }];
      if (text("entity") || text("path")) {
        const next: Spec = { ...spec, stories: [...spec.stories, story] };
        out.push(...placeStory(next, id, { ...(text("entity") ? { entity: text("entity") } : {}), ...(text("path") ? { path: text("path") } : {}) }));
      }
      return out;
    }
    case "data": {
      if (!text("entity")) return null;
      const hit = byName(spec.entities, text("entity"));
      const id = hit?.id ?? freshId("entity", text("entity"), spec.entities.map((e) => e.id));
      const out: Command[] = hit ? [] : [{ type: "addEntity", entity: { id, name: text("entity"), fields: [], relationships: [], seed: [] } }];
      if (!text("name")) return hit ? null : out;
      const type = (text("type") ? needChoice(text("type"), FIELD_TYPES, "Type") : "text") as FieldType;
      const owner: Entity = hit ?? { id, name: text("entity"), fields: [], relationships: [], seed: [] };
      out.push({
        type: "addField", entity: id,
        field: { id: freshId("field", text("name"), owner.fields.map((f) => f.id)), name: text("name"), required: isYes(text("required")), unique: isYes(text("unique")), ...typePatch(spec, owner, type, {}) } as Field,
      });
      return out;
    }
    case "screens": {
      const given = text("path");
      const title = text("title") || (given ? given.replace(/^\//, "") : "");
      if (!title) return null;
      const path = given || `/${slug(title)}`;
      if (!path.startsWith("/")) throw new SheetError('A path starts with "/", for example /buses.');
      return newScreen(spec, title, path, text("entity") ? needEntity(spec, text("entity")).id : undefined, []);
    }
    case "endpoints": {
      if (!text("entity") || !text("operation")) return null;
      const entity = needEntity(spec, text("entity")).id;
      const operation = needChoice(text("operation"), [...OPERATIONS, CUSTOM], "Operation") as Op | "custom";
      const action = operation === CUSTOM ? text("action") : "";
      if (operation === CUSTOM && !action) return null;
      const id = freshId("endpoint", `${slug(entity.replace(/^entity:/, ""))}-${action || operation}`, spec.endpoints.map((e) => e.id));
      return [{ type: "addEndpoint", endpoint: { id, entity, operation, guards: [], services: [], ...(action ? { action } : {}) } }];
    }
    case "services": {
      if (!text("name")) return null;
      const kind = (text("kind") ? needChoice(text("kind"), SERVICE_KINDS, "Kind") : "integration") as "email";
      return [{ type: "addService", service: { id: freshId("service", text("name"), spec.services.map((s) => s.id)), name: text("name"), kind, secrets: list(text("secrets")) } }];
    }
  }
  const e = rowsEntity(spec, tab);
  if (!e || !Object.values(draft).some((v) => v.trim())) return null;
  const { patch, before } = seedPatch(spec, e, draft);
  const seed: Command[] = needsIds(e) ? [{ type: "setSeed", entity: e.id, rows: withIds(e) }] : [];
  return [...before, ...seed, { type: "putSeedRow", entity: e.id, row: drop({ id: newRowId(), ...patch }) as { id: string } }];
}

export function removeRow(spec: Spec, tab: string, rowId: string): Command[] {
  switch (tab) {
    case "roles": return [{ type: "removeRole", id: rowId }];
    case "stories": return [{ type: "removeStory", id: rowId }];
    case "screens": return [{ type: "removeScreen", id: rowId }];
    case "endpoints": return [{ type: "removeEndpoint", id: rowId }];
    case "services": return [{ type: "removeService", id: rowId }];
    case "data": {
      const [entity, field] = rowId.split("|") as [string, string];
      return [field ? { type: "removeField", entity, id: field } : { type: "removeEntity", id: entity }];
    }
  }
  const e = rowsEntity(spec, tab);
  if (!e) return [];
  return [...(needsIds(e) ? [{ type: "setSeed", entity: e.id, rows: withIds(e) } as Command] : []), { type: "removeSeedRow", entity: e.id, id: rowId }];
}

export function moveRow(tab: Tab, rowId: string, before: string | undefined): Command[] {
  if (tab.id === "data") {
    const [entity, id] = rowId.split("|") as [string, string];
    const [beforeEntity, beforeId] = (before ?? "").split("|");
    if (!id || (before && beforeEntity !== entity)) return [];
    return [{ type: "moveItem", list: "fields", entity, id, ...(beforeId ? { before: beforeId } : {}) }];
  }
  return tab.order ? [{ type: "moveItem", list: tab.order.list, id: rowId, ...(before ? { before } : {}) }] : [];
}

export const canReorder = (tab: Tab) => tab.id === "data" || !!tab.order;

/** Sheets where a suggestion's change first shows, in tab order, so the grid can go to it. */
export interface GhostDiff {
  /** `tab\0rowId\0col` -> the suggested text. */
  cells: Map<string, string>;
  /** Rows the suggestion would add, by tab. */
  rows: Map<string, Row[]>;
  first?: { tab: string; rowId: string; col: string };
}
export const ghostKey = (tab: string, rowId: string, col: string) => `${tab}\0${rowId}\0${col}`;

/** The difference between the spec and the spec with a suggestion applied, as cells. */
export function ghostDiff(before: Spec, after: Spec): GhostDiff {
  const out: GhostDiff = { cells: new Map(), rows: new Map() };
  for (const tab of tabsFor(after)) {
    if (tab.fixed) continue;
    const had = new Map(specToRows(before, tab.id).map((r) => [r.id, r]));
    for (const row of specToRows(after, tab.id)) {
      const old = had.get(row.id);
      if (!old) {
        const added = out.rows.get(tab.id) ?? [];
        added.push(row);
        out.rows.set(tab.id, added);
      }
      for (const [col, value] of Object.entries(row.cells)) {
        if ((old?.cells[col] ?? "") === value) continue;
        out.cells.set(ghostKey(tab.id, row.id, col), value);
        out.first ??= { tab: tab.id, rowId: row.id, col };
      }
    }
  }
  return out;
}
