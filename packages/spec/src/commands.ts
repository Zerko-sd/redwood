import { z } from "zod";
import { entity, field, role, story, screen, endpoint, service, subProject, accessRule, theme, type Spec } from "./schema";
import { checkSpec } from "./validate";

/**
 * Every editor (grid, form, Google Sheet, CLI) changes the spec only through
 * these commands. Each is validated and applied as a pure function.
 */
const seedRow = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Optional keys to drop. JSON has no `undefined`, so a patch alone can never empty an optional value. */
const clear = z.array(z.string()).optional();
const drop = (target: object, keys: string[] | undefined) => {
  for (const k of keys ?? []) delete (target as Record<string, unknown>)[k];
};

/** The lists a person can reorder. Fields need the `entity` they belong to. */
export const ORDERED = ["roles", "stories", "entities", "screens", "endpoints", "services", "fields"] as const;

export const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setTitle"), title: z.string().min(1) }),
  z.object({ type: z.literal("addRole"), role }),
  z.object({ type: z.literal("updateRole"), id: z.string(), patch: role.partial().omit({ id: true }) }),
  z.object({ type: z.literal("removeRole"), id: z.string() }),
  z.object({ type: z.literal("setSubProjects"), subProjects: z.array(subProject) }),
  z.object({ type: z.literal("addStory"), story }),
  z.object({ type: z.literal("updateStory"), id: z.string(), patch: story.partial().omit({ id: true }), clear }),
  z.object({ type: z.literal("removeStory"), id: z.string() }),
  z.object({ type: z.literal("addEntity"), entity }),
  z.object({ type: z.literal("updateEntity"), id: z.string(), patch: entity.pick({ name: true, provenance: true }).partial() }),
  z.object({ type: z.literal("removeEntity"), id: z.string() }),
  z.object({ type: z.literal("addField"), entity: z.string(), field }),
  z.object({
    type: z.literal("updateField"),
    entity: z.string(),
    id: z.string(),
    patch: field.partial().omit({ id: true }),
    clear,
  }),
  z.object({ type: z.literal("removeField"), entity: z.string(), id: z.string() }),
  z.object({ type: z.literal("addScreen"), screen }),
  z.object({ type: z.literal("removeScreen"), id: z.string() }),
  z.object({ type: z.literal("updateScreen"), id: z.string(), patch: screen.partial().omit({ id: true }), clear }),
  z.object({ type: z.literal("addEndpoint"), endpoint }),
  z.object({ type: z.literal("updateEndpoint"), id: z.string(), patch: endpoint.partial().omit({ id: true }), clear }),
  z.object({ type: z.literal("removeEndpoint"), id: z.string() }),
  z.object({ type: z.literal("addService"), service }),
  z.object({ type: z.literal("updateService"), id: z.string(), patch: service.partial().omit({ id: true }) }),
  z.object({ type: z.literal("removeService"), id: z.string() }),
  /** Moves `id` to just before `before`, or to the end. */
  z.object({ type: z.literal("moveItem"), list: z.enum(ORDERED), id: z.string(), before: z.string().optional(), entity: z.string().optional() }),
  /** Adds the row, or replaces the one with the same `id`. */
  z.object({ type: z.literal("putSeedRow"), entity: z.string(), row: seedRow.and(z.object({ id: z.string().min(1) })) }),
  z.object({ type: z.literal("removeSeedRow"), entity: z.string(), id: z.string() }),
  z.object({ type: z.literal("setSeed"), entity: z.string(), rows: z.array(seedRow) }),
  z.object({ type: z.literal("grant"), rule: accessRule }),
  z.object({ type: z.literal("revoke"), role: z.string(), entity: z.string() }),
  /** `workflow: null` removes it. */
  z.object({ type: z.literal("setWorkflow"), entity: z.string(), workflow: entity.shape.workflow.unwrap().nullable() }),
  z.object({ type: z.literal("setTheme"), theme: theme.partial() }),
]);
export type Command = z.infer<typeof command>;

export class CommandError extends Error {}

const clone = <T>(v: T): T => structuredClone(v);

/** Applies one command and returns a new spec. Never mutates the input. */
export function applyCommand(prev: Spec, raw: unknown): Spec {
  const cmd = command.parse(raw);
  const s = clone(prev);
  const find = <T extends { id: string }>(list: T[], key: string, what: string): T => {
    const hit = list.find((x) => x.id === key);
    if (!hit) throw new CommandError(`unknown ${what} ${key}`);
    return hit;
  };
  const ensureNew = (list: { id: string }[], key: string) => {
    if (list.some((x) => x.id === key)) throw new CommandError(`${key} already exists`);
  };

  switch (cmd.type) {
    case "setTitle": s.title = cmd.title; break;
    case "addRole": ensureNew(s.roles, cmd.role.id); s.roles.push(cmd.role); break;
    case "updateRole": Object.assign(find(s.roles, cmd.id, "role"), cmd.patch); break;
    case "removeRole": {
      find(s.roles, cmd.id, "role");
      // Stories and workflow moves are written for a role; losing it silently would lose what they mean.
      const stories = s.stories.filter((x) => x.role === cmd.id).length;
      const moves = s.entities.filter((e) => e.workflow?.transitions.some((t) => t.roles.includes(cmd.id)));
      if (stories || moves.length) {
        const uses = [stories ? `${stories} ${stories === 1 ? "story" : "stories"}` : "", ...moves.map((e) => `the workflow on ${e.id}`)];
        throw new CommandError(`${cmd.id} is still used by ${uses.filter(Boolean).join(", ")}; change those first`);
      }
      s.roles = s.roles.filter((x) => x.id !== cmd.id);
      s.access = s.access.filter((x) => x.role !== cmd.id);
      for (const sc of s.screens) sc.roles = sc.roles.filter((x) => x !== cmd.id);
      for (const sp of s.subProjects) sp.roles = sp.roles.filter((x) => x !== cmd.id);
      break;
    }
    case "setSubProjects": s.subProjects = cmd.subProjects; break;
    case "addStory": ensureNew(s.stories, cmd.story.id); s.stories.push(cmd.story); break;
    case "updateStory": {
      const st = find(s.stories, cmd.id, "story");
      Object.assign(st, cmd.patch);
      drop(st, cmd.clear);
      break;
    }
    case "removeStory":
      s.stories = s.stories.filter((x) => x.id !== cmd.id);
      for (const sc of s.screens) sc.stories = sc.stories.filter((x) => x !== cmd.id);
      break;
    case "addEntity": ensureNew(s.entities, cmd.entity.id); s.entities.push(cmd.entity); break;
    case "updateEntity": Object.assign(find(s.entities, cmd.id, "entity"), cmd.patch); break;
    case "removeEntity": {
      find(s.entities, cmd.id, "entity");
      // Another entity pointing here is a modelling decision a person must make.
      const users = s.entities.filter(
        (e) =>
          e.id !== cmd.id &&
          (e.fields.some((f) => f.references === cmd.id) || e.relationships.some((r) => r.to === cmd.id)),
      );
      if (users.length) {
        throw new CommandError(
          `${cmd.id} is still referenced by ${users.map((e) => e.id).join(", ")}; remove those links first`,
        );
      }
      const gone = new Set(s.endpoints.filter((x) => x.entity === cmd.id).map((x) => x.id));
      s.entities = s.entities.filter((x) => x.id !== cmd.id);
      s.endpoints = s.endpoints.filter((x) => x.entity !== cmd.id);
      s.access = s.access.filter((x) => x.entity !== cmd.id);
      for (const sc of s.screens) {
        if (sc.entity === cmd.id) delete sc.entity;
        sc.endpoints = sc.endpoints.filter((x) => !gone.has(x));
      }
      break;
    }
    case "addField": {
      const e = find(s.entities, cmd.entity, "entity");
      ensureNew(e.fields, cmd.field.id);
      e.fields.push(cmd.field);
      break;
    }
    case "updateField": {
      const e = find(s.entities, cmd.entity, "entity");
      const f = find(e.fields, cmd.id, "field");
      const was = f.name;
      Object.assign(f, cmd.patch);
      drop(f, cmd.clear);
      // Workflows and access rules name a field, so a rename has to reach them.
      if (cmd.patch.name && cmd.patch.name !== was) {
        const rename = (n: string) => (n === was ? cmd.patch.name! : n);
        if (e.workflow) e.workflow.field = rename(e.workflow.field);
        for (const a of s.access.filter((x) => x.entity === e.id)) {
          if (a.ownerField) a.ownerField = rename(a.ownerField);
          a.hiddenFields = a.hiddenFields.map(rename);
          a.readOnlyFields = a.readOnlyFields.map(rename);
        }
      }
      break;
    }
    case "removeField": {
      const e = find(s.entities, cmd.entity, "entity");
      e.fields = e.fields.filter((x) => x.id !== cmd.id);
      for (const row of e.seed) delete row[cmd.id];
      for (const sc of s.screens) {
        if (sc.entity === cmd.entity) sc.fields = sc.fields.filter((x) => x !== cmd.id);
      }
      break;
    }
    case "addScreen": ensureNew(s.screens, cmd.screen.id); s.screens.push(cmd.screen); break;
    case "removeScreen": s.screens = s.screens.filter((x) => x.id !== cmd.id); break;
    case "updateScreen": {
      const sc = find(s.screens, cmd.id, "screen");
      Object.assign(sc, cmd.patch);
      drop(sc, cmd.clear);
      break;
    }
    case "addEndpoint": ensureNew(s.endpoints, cmd.endpoint.id); s.endpoints.push(cmd.endpoint); break;
    case "updateEndpoint": {
      const ep = find(s.endpoints, cmd.id, "endpoint");
      Object.assign(ep, cmd.patch);
      drop(ep, cmd.clear);
      break;
    }
    case "removeEndpoint":
      find(s.endpoints, cmd.id, "endpoint");
      s.endpoints = s.endpoints.filter((x) => x.id !== cmd.id);
      for (const sc of s.screens) sc.endpoints = sc.endpoints.filter((x) => x !== cmd.id);
      break;
    case "addService": ensureNew(s.services, cmd.service.id); s.services.push(cmd.service); break;
    case "updateService": Object.assign(find(s.services, cmd.id, "service"), cmd.patch); break;
    case "removeService":
      find(s.services, cmd.id, "service");
      s.services = s.services.filter((x) => x.id !== cmd.id);
      for (const ep of s.endpoints) ep.services = ep.services.filter((x) => x !== cmd.id);
      break;
    case "moveItem": {
      const list: { id: string }[] = cmd.list === "fields"
        ? find(s.entities, cmd.entity ?? "", "entity").fields
        : s[cmd.list];
      const from = list.findIndex((x) => x.id === cmd.id);
      if (from < 0) throw new CommandError(`unknown ${cmd.id} in ${cmd.list}`);
      const [item] = list.splice(from, 1);
      const to = cmd.before === undefined ? list.length : list.findIndex((x) => x.id === cmd.before);
      if (to < 0) throw new CommandError(`unknown ${cmd.before} in ${cmd.list}`);
      list.splice(to, 0, item!);
      break;
    }
    case "putSeedRow": {
      const e = find(s.entities, cmd.entity, "entity");
      const at = e.seed.findIndex((r) => r.id === cmd.row.id);
      if (at >= 0) e.seed[at] = cmd.row; else e.seed.push(cmd.row);
      break;
    }
    case "removeSeedRow": {
      const e = find(s.entities, cmd.entity, "entity");
      e.seed = e.seed.filter((r) => r.id !== cmd.id);
      // Other tables' sample rows may point here; a dangling link would stop the seed loading at all.
      for (const other of s.entities) {
        for (const f of other.fields.filter((x) => x.references === e.id)) {
          for (const row of other.seed) if (row[f.id] === cmd.id) delete row[f.id];
        }
      }
      break;
    }
    case "setSeed": find(s.entities, cmd.entity, "entity").seed = cmd.rows; break;
    case "grant":
      s.access = s.access.filter((x) => !(x.role === cmd.rule.role && x.entity === cmd.rule.entity));
      s.access.push(cmd.rule);
      break;
    case "revoke":
      s.access = s.access.filter((x) => !(x.role === cmd.role && x.entity === cmd.entity));
      break;
    case "setWorkflow": {
      const e = find(s.entities, cmd.entity, "entity");
      if (cmd.workflow) e.workflow = cmd.workflow; else delete e.workflow;
      break;
    }
    case "setTheme": Object.assign(s.theme, cmd.theme); break;
  }

  const { issues } = checkSpec(s);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new CommandError(errors.map((e) => `${e.path}: ${e.message}`).join("; "));
  }
  return s;
}

/**
 * The items a command changes, as stable IDs. Two commands conflict when they touch the same item;
 * anything the server doesn't recognise (such as a restore) touches "*", which conflicts with everything.
 */
export function touches(raw: unknown): string[] {
  const c = raw as Partial<Command> & { type?: string };
  switch (c.type) {
    case "setTitle": return ["title"];
    case "addRole": return [(c as Extract<Command, { type: "addRole" }>).role.id];
    case "addStory": return [(c as Extract<Command, { type: "addStory" }>).story.id];
    case "addEntity": return [(c as Extract<Command, { type: "addEntity" }>).entity.id];
    case "addField": {
      const f = c as Extract<Command, { type: "addField" }>;
      return [`${f.entity}/${f.field.id}`];
    }
    case "addScreen": return [(c as Extract<Command, { type: "addScreen" }>).screen.id];
    case "addEndpoint": return [(c as Extract<Command, { type: "addEndpoint" }>).endpoint.id];
    case "updateStory": case "removeStory": case "removeEntity": case "removeScreen": case "updateScreen":
      return [(c as { id: string }).id];
    case "updateField": case "removeField": {
      const f = c as { entity: string; id: string };
      return [`${f.entity}/${f.id}`];
    }
    case "updateRole": case "removeRole": case "updateEntity": case "updateEndpoint": case "removeEndpoint":
    case "updateService": case "removeService":
      return [(c as { id: string }).id];
    case "addService": return [(c as Extract<Command, { type: "addService" }>).service.id];
    case "setSubProjects": return ["subProjects"];
    case "moveItem": {
      const m = c as Extract<Command, { type: "moveItem" }>;
      return [`order:${m.entity ?? ""}:${m.list}`];
    }
    case "putSeedRow": {
      const r = c as Extract<Command, { type: "putSeedRow" }>;
      return [`seed:${r.entity}:${r.row.id}`];
    }
    case "removeSeedRow": {
      const r = c as Extract<Command, { type: "removeSeedRow" }>;
      return [`seed:${r.entity}:${r.id}`];
    }
    case "setSeed": return [`seed:${(c as { entity: string }).entity}`];
    case "grant": {
      const r = (c as Extract<Command, { type: "grant" }>).rule;
      return [`access:${r.role}:${r.entity}`];
    }
    case "revoke": {
      const r = c as Extract<Command, { type: "revoke" }>;
      return [`access:${r.role}:${r.entity}`];
    }
    case "setWorkflow": return [`workflow:${(c as { entity: string }).entity}`];
    case "setTheme": return ["theme"];
    default: return ["*"];
  }
}
