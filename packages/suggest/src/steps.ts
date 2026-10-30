import { THEMES } from "@redwood/parts";
import { FIELD_TYPES, OPERATIONS, type Command, type Provenance, type Spec } from "@redwood/spec";
import { LlmBadOutput, LlmUnavailable, hashPrompt, type LlmClient } from "./llm";
import { entityPrompt, fieldsPrompt, operationsPrompt, rulesPrompt, servicePrompt, themePrompt } from "./prompts";
import type { StepName, Suggestion } from "./types";
import { VERB_ENTITIES, WRITES, defaultPath, freshId, hash, humanize, isUsablePath, norm, plural, slug } from "./util";

export interface Context {
  /** Null when no model is configured: rule steps still work, AI steps report that. */
  llm: LlmClient | null;
  decided: ReadonlySet<string>;
  /** Called for a question that turned out to need no change, so it is not asked again. */
  decide(key: string): void;
}

export const NO_MODEL = "No model is configured. Set NEBIUS_API_KEY (see .env.example) and restart the server.";
/** The model, asked for only once a step has a real question; a spec with nothing to ask never needs one. */
function need(ctx: Context): LlmClient {
  if (!ctx.llm) throw new LlmUnavailable(NO_MODEL);
  return ctx.llm;
}

type Story = Spec["stories"][number];
type Entity = Spec["entities"][number];
type Screen = Spec["screens"][number];
type Op = (typeof OPERATIONS)[number];

const PROMPT_VERSION = "v1";
const prov = (source: "ai" | "rule", s: Pick<Suggestion, "model" | "promptHash">, storyRefs: string[], inputHash: string): Provenance => ({
  source, ...(s.model ? { model: s.model } : {}), promptVersion: PROMPT_VERSION, inputHash, storyRefs, degraded: false,
});

/** Asks, validates, and asks once more if the answer was outside the closed sets. A second failure is reported, not guessed. */
async function ask<T>(llm: LlmClient, prompt: string, schema: object, check: (raw: Record<string, unknown>) => T): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return check((await llm.json(prompt, schema)) as Record<string, unknown>);
    } catch (e) {
      if (!(e instanceof LlmBadOutput)) throw e;
      last = e;
    }
  }
  throw last;
}

const roleName = (spec: Spec, id: string) => spec.roles.find((r) => r.id === id)?.name ?? id;
const storiesOf = (spec: Spec, screens: Screen[]): Story[] => {
  const ids = new Set(screens.flatMap((s) => s.stories));
  return spec.stories.filter((s) => ids.has(s.id));
};
const problem = (key: string, step: StepName, title: string, e: unknown, because: string[] = []): Suggestion => ({
  key, step, title, lines: [], because, commands: [], source: "ai", problem: e instanceof Error ? e.message : String(e),
});

// ---------------------------------------------------------------------------------------------- place

/** The first story no screen serves: which table does it act on, and which page does it live on? */
export async function place(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  const story = spec.stories.find((s) => {
    const key = `place:${s.id}:${hash(s.action, s.role)}`;
    return !spec.screens.some((sc) => sc.stories.includes(s.id)) && !ctx.decided.has(key);
  });
  if (!story) return null;
  const key = `place:${story.id}:${hash(story.action, story.role)}`;
  const llm = need(ctx);
  const prompt = entityPrompt({
    story: story.action, role: roleName(spec, story.role), entities: spec.entities.map((e) => e.name), paths: spec.screens.map((s) => s.path),
  });
  const schema = { type: "object", properties: { entity: { type: "string" }, path: { type: "string" } }, required: ["entity", "path"] };
  let got: { entity: string; path: string | null };
  try {
    got = await ask(llm, prompt, schema, (raw) => {
      const entity = typeof raw.entity === "string" ? raw.entity.trim() : "";
      if (!entity) throw new LlmBadOutput("entity missing or empty");
      if (VERB_ENTITIES.has(entity.toLowerCase())) throw new LlmBadOutput(`entity is a verb: "${entity}"`);
      // The path has a deterministic fallback, so an unusable one is dropped rather than failing the answer.
      return { entity, path: isUsablePath(raw.path) ? raw.path.trim() : null };
    });
  } catch (e) {
    if (e instanceof LlmBadOutput) return problem(key, "place", `"${story.action}"`, e, [story.id]);
    throw e;
  }

  const name = humanize(got.entity);
  const existing = spec.entities.find((e) => norm(e.name) === norm(name));
  const entityId = existing?.id ?? freshId("entity", name, spec.entities.map((e) => e.id));
  const path = choosePath(spec, entityId, name, got.path);
  const screen = spec.screens.find((s) => s.path === path);
  const base = { model: llm.model, promptHash: hashPrompt(prompt) };
  const p = prov("ai", base, [story.id], hash(story.action, story.role));

  const commands: Command[] = [];
  if (!existing) commands.push({ type: "addEntity", entity: { id: entityId, name, fields: [], relationships: [], seed: [], provenance: p } });
  if (screen) {
    commands.push({ type: "updateScreen", id: screen.id, patch: { stories: [...screen.stories, story.id], ...(screen.entity ? {} : { entity: entityId }) } });
  } else {
    const title = humanize(plural(name));
    commands.push({
      type: "addScreen",
      screen: { id: freshId("screen", title, spec.screens.map((s) => s.id)), title, path, entity: entityId, stories: [story.id], endpoints: [], blocks: [], bento: {}, roles: [], fields: [], placement: "nav" },
    });
  }
  return {
    key, step: "place", source: "ai", ...base, because: [story.id], commands,
    title: `"${story.action}"`,
    lines: [
      `Table: ${name}${existing ? " (already there)" : " (new)"}`,
      screen ? `Page: ${screen.title} at ${path} (already there)` : `Page: ${path} (new)`,
    ],
  };
}

/** The model's path if it can be used here, else the table's own list path; never a path another table owns. */
function choosePath(spec: Spec, entityId: string, entityName: string, proposed: string | null): string {
  const free = (path: string) => {
    const at = spec.screens.find((s) => s.path === path);
    return !at || !at.entity || at.entity === entityId;
  };
  for (const c of [proposed, defaultPath(entityName)]) if (c && free(c)) return c;
  const base = defaultPath(entityName);
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

// ---------------------------------------------------------------------------------------------- fields

/** The first table with stories and no fields: which fields do those stories imply? */
export async function fields(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  for (const entity of spec.entities) {
    if (entity.fields.length) continue;
    const stories = storiesOf(spec, spec.screens.filter((s) => s.entity === entity.id));
    if (!stories.length) continue;
    const key = `fields:${entity.id}:${hash(stories.map((s) => s.action))}`;
    if (ctx.decided.has(key)) continue;

    const llm = need(ctx);
    const others = spec.entities.filter((e) => e.id !== entity.id);
    const types = FIELD_TYPES.filter((t) => t !== "reference" || others.length);
    const prompt = fieldsPrompt({ entity: entity.name, stories: stories.map((s) => s.action), otherEntities: others.map((e) => e.name), types });
    const schema = {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: types },
              options: { type: "array", items: { type: "string" } },
              ...(others.length ? { references: { type: "string", enum: others.map((e) => e.name) } } : {}),
            },
            required: ["name", "type"],
          },
        },
      },
      required: ["fields"],
    };
    const base = { model: llm.model, promptHash: hashPrompt(prompt) };
    const because = stories.map((s) => s.id);
    try {
      const proposed = await ask(llm, prompt, schema, (raw) => {
        if (!Array.isArray(raw.fields)) throw new LlmBadOutput("fields missing");
        const seen = new Set<string>(["id", "createdat", "createdby", "deleted", "isdeleted"]);
        const out: { name: string; type: (typeof FIELD_TYPES)[number]; options?: string[]; references?: string }[] = [];
        for (const f of raw.fields as Record<string, unknown>[]) {
          const name = typeof f?.name === "string" ? f.name.trim() : "";
          if (!name) throw new LlmBadOutput("field without a name");
          if (typeof f.type !== "string" || !(types as readonly string[]).includes(f.type)) throw new LlmBadOutput(`field type "${String(f.type)}" is not allowed`);
          if (seen.has(norm(name))) continue;
          seen.add(norm(name));
          let type = f.type as (typeof FIELD_TYPES)[number];
          const options = Array.isArray(f.options) ? [...new Set((f.options as unknown[]).filter((o): o is string => typeof o === "string" && !!o.trim()).map((o) => o.trim()))] : [];
          const target = others.find((e) => e.name === f.references);
          // A choice with nothing to choose from, or a reference to nothing, is just text.
          if (type === "choice" && !options.length) type = "text";
          if (type === "reference" && !target) type = "text";
          out.push({ name, type, ...(type === "choice" ? { options } : {}), ...(type === "reference" ? { references: target!.id } : {}) });
        }
        return out;
      });
      const rule = proposed.length === 0;
      const list = rule ? [{ name: "Name", type: "text" as const }] : proposed;
      const taken: string[] = [];
      const p = prov(rule ? "rule" : "ai", base, because, hash(stories.map((s) => s.action)));
      const commands: Command[] = list.map((f) => {
        const id = freshId("field", f.name, taken);
        taken.push(id);
        return { type: "addField", entity: entity.id, field: { id, name: f.name, type: f.type, required: rule, unique: false, ...("options" in f ? { options: f.options } : {}), ...("references" in f ? { references: f.references } : {}), provenance: p } } as Command;
      });
      return {
        key, step: "fields", source: rule ? "rule" : "ai", ...base, because, commands,
        title: `Fields for ${entity.name}`,
        lines: [...list.map((f) => `${f.name} (${f.type}${"options" in f && f.options?.length ? `: ${f.options.join(", ")}` : ""})`), ...(rule ? ["The stories imply no fields, so it starts with a name."] : [])],
      };
    } catch (e) {
      if (e instanceof LlmBadOutput) return problem(key, "fields", `Fields for ${entity.name}`, e, because);
      throw e;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- operations

/** The first screen over a table with no operations: what do its stories do to the records? */
export async function operations(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  for (const screen of spec.screens) {
    const entity = spec.entities.find((e) => e.id === screen.entity);
    if (!entity || screen.endpoints.length || !screen.stories.length) continue;
    const stories = storiesOf(spec, [screen]);
    const key = `operations:${screen.id}:${hash(stories.map((s) => s.action), entity.fields.map((f) => f.name))}`;
    if (ctx.decided.has(key)) continue;

    const llm = need(ctx);
    const prompt = operationsPrompt({
      path: screen.path, title: screen.title, entity: entity.name, fields: entity.fields.map((f) => f.name), operations: OPERATIONS,
      stories: stories.map((s) => ({ role: roleName(spec, s.role), story: s.action })),
    });
    const schema = {
      type: "object",
      properties: { operations: { type: "array", items: { type: "string", enum: [...OPERATIONS] } }, customActions: { type: "array", items: { type: "string" } } },
      required: ["operations", "customActions"],
    };
    const base = { model: llm.model, promptHash: hashPrompt(prompt) };
    const because = stories.map((s) => s.id);
    try {
      const got = await ask(llm, prompt, schema, (raw) => {
        if (!Array.isArray(raw.operations)) throw new LlmBadOutput("operations missing");
        const ops = new Set<Op>();
        for (const o of raw.operations) {
          if (typeof o !== "string" || !(OPERATIONS as readonly string[]).includes(o)) throw new LlmBadOutput(`operation "${String(o)}" is not one of ${OPERATIONS.join(", ")}`);
          ops.add(o as Op);
        }
        const custom = Array.isArray(raw.customActions)
          ? [...new Set((raw.customActions as unknown[]).filter((a): a is string => typeof a === "string" && a.trim().split(/\s+/).length <= 4 && !!a.trim()).map((a) => a.trim()))]
          : [];
        if (!ops.size && !custom.length) throw new LlmBadOutput("no operations for a screen that has stories");
        // A story that changes records cannot be served by a screen that only reads them.
        const writes = [...ops].some((o) => o === "create" || o === "update" || o === "delete") || custom.length > 0;
        if (!writes && stories.some((s) => WRITES.test(s.action))) throw new LlmBadOutput("the stories change records but no operation that writes was chosen");
        if ((ops.has("read") || ops.has("update") || ops.has("delete")) && !ops.has("list")) ops.add("list");
        return { ops: OPERATIONS.filter((o) => ops.has(o)), custom };
      });

      const taken = spec.endpoints.map((e) => e.id);
      const ids: string[] = [];
      const commands: Command[] = [];
      const p = prov("ai", base, because, hash(stories.map((s) => s.action)));
      const eslug = slug(entity.name);
      for (const op of got.ops) {
        const have = spec.endpoints.find((e) => e.entity === entity.id && e.operation === op);
        if (have) { ids.push(have.id); continue; }
        const id = freshId("endpoint", `${eslug}-${op}`, taken);
        taken.push(id); ids.push(id);
        commands.push({ type: "addEndpoint", endpoint: { id, entity: entity.id, operation: op, guards: [], services: [], provenance: p } });
      }
      for (const action of got.custom) {
        const have = spec.endpoints.find((e) => e.entity === entity.id && e.operation === "custom" && e.action === action);
        if (have) { ids.push(have.id); continue; }
        const id = freshId("endpoint", `${eslug}-${action}`, taken);
        taken.push(id); ids.push(id);
        commands.push({ type: "addEndpoint", endpoint: { id, entity: entity.id, operation: "custom", action, guards: [], services: [], provenance: p } });
      }
      commands.push({ type: "updateScreen", id: screen.id, patch: { endpoints: ids } });
      return {
        key, step: "operations", source: "ai", ...base, because, commands,
        title: `What ${screen.title} can do`,
        lines: [got.ops.join(", "), ...got.custom.map((a) => `Custom action (a developer builds it): ${a}`)],
      };
    } catch (e) {
      if (e instanceof LlmBadOutput) return problem(key, "operations", `What ${screen.title} can do`, e, because);
      throw e;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- audience (rule)

/** A page is for the roles whose stories it serves. All roles is written as "everyone" (no list). */
export function audience(spec: Spec, ctx: Context): Suggestion | null {
  const changes: { screen: Screen; roles: string[] }[] = [];
  for (const screen of spec.screens) {
    if (!screen.stories.length) continue;
    const used = new Set(storiesOf(spec, [screen]).map((s) => s.role));
    const derived = spec.roles.map((r) => r.id).filter((r) => used.has(r));
    const desired = derived.length === spec.roles.length ? [] : derived;
    if (desired.length !== screen.roles.length || desired.some((r) => !screen.roles.includes(r))) changes.push({ screen, roles: desired });
  }
  if (!changes.length) return null;
  const key = `audience:${hash(changes.map((c) => [c.screen.id, c.roles]))}`;
  if (ctx.decided.has(key)) return null;
  return {
    key, step: "audience", source: "rule", because: [...new Set(changes.flatMap((c) => c.screen.stories))],
    title: "Who opens each page",
    lines: changes.map((c) => `${c.screen.title}: ${c.roles.length ? c.roles.map((r) => roleName(spec, r)).join(", ") : "everyone"}`),
    commands: changes.map((c) => ({ type: "updateScreen", id: c.screen.id, patch: { roles: c.roles } }) as Command),
  };
}

// ---------------------------------------------------------------------------------------------- access (rule)

/** A role may do what the pages its stories live on can do, and nothing else. Only fills in missing rules. */
export function access(spec: Spec, ctx: Context): Suggestion | null {
  const grants: { role: string; entity: string; operations: Op[] }[] = [];
  for (const role of spec.roles) {
    for (const entity of spec.entities) {
      if (spec.access.some((a) => a.role === role.id && a.entity === entity.id)) continue;
      const ops = new Set<Op>();
      for (const screen of spec.screens) {
        if (screen.entity !== entity.id) continue;
        if (!storiesOf(spec, [screen]).some((s) => s.role === role.id)) continue;
        for (const ep of spec.endpoints) if (screen.endpoints.includes(ep.id) && ep.operation !== "custom") ops.add(ep.operation);
      }
      if (ops.has("list")) ops.add("read"); // a listed record can be opened
      if (ops.size) grants.push({ role: role.id, entity: entity.id, operations: OPERATIONS.filter((o) => ops.has(o)) });
    }
  }
  if (!grants.length) return null;
  const key = `access:${hash(grants)}`;
  if (ctx.decided.has(key)) return null;
  return {
    key, step: "access", source: "rule", because: [],
    title: "Who can do what",
    lines: grants.map((g) => `${roleName(spec, g.role)} on ${spec.entities.find((e) => e.id === g.entity)!.name}: ${g.operations.join(", ")}`),
    commands: grants.map((g) => ({ type: "grant", rule: { role: g.role, entity: g.entity, operations: g.operations, hiddenFields: [], readOnlyFields: [] } }) as Command),
  };
}

// ---------------------------------------------------------------------------------------------- rules (status buttons, own records)

/** Who moves a record through its states, and who sees only their own records. */
export async function rules(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  const entities = spec.entities.filter((e) => e.fields.length);
  if (!entities.length || !spec.roles.length) return null;
  const key = `rules:${hash(spec.roles.map((r) => r.id), spec.stories.map((s) => [s.role, s.action]), entities.map((e) => [e.id, e.fields.map((f) => [f.name, f.type, f.options])]))}`;
  if (ctx.decided.has(key)) return null;

  const llm = need(ctx);
  const roleIds = spec.roles.map((r) => r.id);
  const nameToRole = new Map(spec.roles.map((r) => [r.name, r.id]));
  const prompt = rulesPrompt({
    roles: spec.roles.map((r) => r.name),
    stories: spec.stories.map((s) => ({ role: roleName(spec, s.role), story: s.action })),
    entities: entities.map((e) => ({ name: e.name, fields: e.fields.map((f) => ({ name: f.name, type: f.type, ...(f.options ? { options: f.options } : {}) })) })),
  });
  const roleList = { type: "array", items: { type: "string", enum: [...nameToRole.keys()] } };
  const schema = {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", enum: entities.map((e) => e.name) },
            actions: { type: "array", items: { type: "object", properties: { field: { type: "string" }, label: { type: "string" }, value: { type: "string" }, roles: roleList }, required: ["field", "label", "value", "roles"] } },
            own_records: { type: "array", items: { type: "object", properties: { role: { type: "string", enum: [...nameToRole.keys()] }, field: { type: "string" } }, required: ["role", "field"] } },
          },
          required: ["name", "actions", "own_records"],
        },
      },
    },
    required: ["entities"],
  };
  const base = { model: llm.model, promptHash: hashPrompt(prompt) };
  try {
    const raw = await ask(llm, prompt, schema, (r) => {
      if (!Array.isArray(r.entities)) throw new LlmBadOutput("entities missing");
      return r.entities as Record<string, unknown>[];
    });

    const commands: Command[] = [];
    const lines: string[] = [];
    // Many small decisions in one answer: one name outside the closed sets drops that item, never the whole answer.
    for (const item of raw) {
      const entity = entities.find((e) => e.name === item?.name);
      if (!entity) continue;
      const actions = (Array.isArray(item.actions) ? item.actions : []).flatMap((a: Record<string, unknown>) => {
        const field = entity.fields.find((f) => f.name === a?.field && f.type === "choice" && f.options?.length);
        const label = typeof a?.label === "string" ? a.label.trim() : "";
        if (!field || !label || label.split(/\s+/).length > 2 || typeof a.value !== "string" || !field.options!.includes(a.value)) return [];
        // A button named after its value is not an action anyone takes; nor is one that returns to the start.
        if (norm(label) === norm(a.value) || a.value === field.options![0]) return [];
        const rs = (Array.isArray(a.roles) ? a.roles : []).map((n) => nameToRole.get(String(n))).filter((r): r is string => !!r && roleIds.includes(r));
        return rs.length ? [{ field, label, value: a.value, roles: [...new Set(rs)] }] : [];
      });
      if (actions.length && !entity.workflow) {
        const field = actions[0]!.field;
        const forField = actions.filter((a) => a.field.id === field.id);
        const states = field.options!;
        const transitions = forField.flatMap((a) => states.filter((s) => s !== a.value).map((from) => ({ from, to: a.value, roles: a.roles })));
        commands.push({ type: "setWorkflow", entity: entity.id, workflow: { field: field.name, states, transitions } });
        lines.push(`${entity.name}: ${forField.map((a) => `${a.label} (→ ${a.value}) by ${a.roles.map((r) => roleName(spec, r)).join(", ")}`).join("; ")}`);
      }
      for (const o of Array.isArray(item.own_records) ? (item.own_records as Record<string, unknown>[]) : []) {
        const role = nameToRole.get(String(o?.role));
        const field = entity.fields.find((f) => f.name === o?.field && f.type === "text");
        const rule = role && spec.access.find((a) => a.role === role && a.entity === entity.id);
        if (!role || !field || !rule || rule.ownerField) continue;
        commands.push({ type: "grant", rule: { ...rule, ownerField: field.name } });
        lines.push(`${roleName(spec, role)} sees only their own ${entity.name} records (where ${field.name} is them)`);
      }
    }
    if (!commands.length) { ctx.decide(key); return null; }
    return { key, step: "rules", source: "ai", ...base, because: [], commands, title: "Status buttons and own records", lines };
  } catch (e) {
    if (e instanceof LlmBadOutput) return problem(key, "rules", "Status buttons and own records", e);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------- services

const SERVICE_KINDS = ["email", "notification", "job", "storage", "audit", "integration"] as const;

/** The first custom action with no service: does it need one? Plain CRUD never does, so only custom actions are asked. */
export async function services(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  for (const ep of spec.endpoints) {
    if (ep.operation !== "custom" || ep.services.length) continue;
    const entity = spec.entities.find((e) => e.id === ep.entity);
    if (!entity) continue;
    const key = `services:${ep.id}:${hash(ep.action, spec.services.map((s) => s.name))}`;
    if (ctx.decided.has(key)) continue;

    const llm = need(ctx);
    const prompt = servicePrompt({ entity: entity.name, action: ep.action ?? ep.id, services: spec.services.map((s) => s.name), kinds: SERVICE_KINDS });
    const schema = {
      type: "object",
      properties: { needsService: { type: "boolean" }, serviceName: { type: ["string", "null"] }, kind: { type: "string", enum: [...SERVICE_KINDS] } },
      required: ["needsService"],
    };
    const base = { model: llm.model, promptHash: hashPrompt(prompt) };
    const title = `Services for ${ep.action ?? ep.id}`;
    try {
      const got = await ask(llm, prompt, schema, (raw) => {
        if (raw.needsService !== true) return null;
        const name = typeof raw.serviceName === "string" ? raw.serviceName.trim() : "";
        if (!name) throw new LlmBadOutput("a service is needed but none was named");
        const kind = (SERVICE_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as (typeof SERVICE_KINDS)[number]) : "integration";
        return { name, kind };
      });
      if (!got) { ctx.decide(key); continue; }
      const existing = spec.services.find((s) => norm(s.name) === norm(got.name));
      const id = existing?.id ?? freshId("service", got.name, spec.services.map((s) => s.id));
      const commands: Command[] = [
        ...(existing ? [] : [{ type: "addService", service: { id, name: got.name, kind: got.kind, secrets: [] } } as Command]),
        { type: "updateEndpoint", id: ep.id, patch: { services: [id] } },
      ];
      return { key, step: "services", source: "ai", ...base, because: [], commands, title, lines: [`${got.name}${existing ? " (already there)" : ` (new, ${got.kind})`}`] };
    } catch (e) {
      if (e instanceof LlmBadOutput) return problem(key, "services", title, e);
      throw e;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- theme

/** Which of the fixed themes fits who uses the app. Never CSS: the answer is one name from the list. */
export async function theme(spec: Spec, ctx: Context): Promise<Suggestion | null> {
  if (!spec.stories.length) return null;
  const key = `theme:${hash(spec.title, spec.stories.map((s) => [s.role, s.action]))}`;
  if (ctx.decided.has(key)) return null;
  const llm = need(ctx);
  const ids = Object.keys(THEMES);
  const prompt = themePrompt({
    title: spec.title, roles: spec.roles.map((r) => r.name), screens: spec.screens.map((s) => s.title),
    stories: spec.stories.map((s) => ({ role: roleName(spec, s.role), story: s.action })),
    themes: ids.map((id) => ({ id, description: THEMES[id]!.description })),
  });
  const schema = { type: "object", properties: { theme: { type: "string", enum: ids }, reason: { type: "string" } }, required: ["theme", "reason"] };
  const base = { model: llm.model, promptHash: hashPrompt(prompt) };
  try {
    const got = await ask(llm, prompt, schema, (raw) => {
      if (typeof raw.theme !== "string" || !ids.includes(raw.theme)) throw new LlmBadOutput(`theme "${String(raw.theme)}" is not one of ${ids.join(", ")}`);
      return { preset: raw.theme, reason: typeof raw.reason === "string" ? raw.reason.trim() : "" };
    });
    if (got.preset === spec.theme.preset) { ctx.decide(key); return null; }
    return {
      key, step: "theme", source: "ai", ...base, because: [], title: `Look: ${got.preset}`,
      lines: [got.reason || THEMES[got.preset]!.description],
      commands: [{ type: "setTheme", theme: { preset: got.preset } }],
    };
  } catch (e) {
    if (e instanceof LlmBadOutput) return problem(key, "theme", "The app's look", e);
    throw e;
  }
}
