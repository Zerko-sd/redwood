import { z } from "zod";
import { entity, field, role, story, screen, endpoint, accessRule, theme, type Spec } from "./schema";
import { checkSpec } from "./validate";

/**
 * Every editor (grid, form, Google Sheet, CLI) changes the spec only through
 * these commands. Each is validated and applied as a pure function.
 */
export const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setTitle"), title: z.string().min(1) }),
  z.object({ type: z.literal("addRole"), role }),
  z.object({ type: z.literal("addStory"), story }),
  z.object({ type: z.literal("updateStory"), id: z.string(), patch: story.partial().omit({ id: true }) }),
  z.object({ type: z.literal("removeStory"), id: z.string() }),
  z.object({ type: z.literal("addEntity"), entity }),
  z.object({ type: z.literal("removeEntity"), id: z.string() }),
  z.object({ type: z.literal("addField"), entity: z.string(), field }),
  z.object({
    type: z.literal("updateField"),
    entity: z.string(),
    id: z.string(),
    patch: field.partial().omit({ id: true }),
  }),
  z.object({ type: z.literal("removeField"), entity: z.string(), id: z.string() }),
  z.object({ type: z.literal("addScreen"), screen }),
  z.object({ type: z.literal("removeScreen"), id: z.string() }),
  z.object({ type: z.literal("updateScreen"), id: z.string(), patch: screen.partial().omit({ id: true }) }),
  z.object({ type: z.literal("addEndpoint"), endpoint }),
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
    case "addStory": ensureNew(s.stories, cmd.story.id); s.stories.push(cmd.story); break;
    case "updateStory": Object.assign(find(s.stories, cmd.id, "story"), cmd.patch); break;
    case "removeStory":
      s.stories = s.stories.filter((x) => x.id !== cmd.id);
      for (const sc of s.screens) sc.stories = sc.stories.filter((x) => x !== cmd.id);
      break;
    case "addEntity": ensureNew(s.entities, cmd.entity.id); s.entities.push(cmd.entity); break;
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
      Object.assign(find(e.fields, cmd.id, "field"), cmd.patch);
      break;
    }
    case "removeField": {
      const e = find(s.entities, cmd.entity, "entity");
      e.fields = e.fields.filter((x) => x.id !== cmd.id);
      for (const row of e.seed) delete row[cmd.id];
      break;
    }
    case "addScreen": ensureNew(s.screens, cmd.screen.id); s.screens.push(cmd.screen); break;
    case "removeScreen": s.screens = s.screens.filter((x) => x.id !== cmd.id); break;
    case "updateScreen": Object.assign(find(s.screens, cmd.id, "screen"), cmd.patch); break;
    case "addEndpoint": ensureNew(s.endpoints, cmd.endpoint.id); s.endpoints.push(cmd.endpoint); break;
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
    case "addField": return [(c as Extract<Command, { type: "addField" }>).field.id];
    case "addScreen": return [(c as Extract<Command, { type: "addScreen" }>).screen.id];
    case "addEndpoint": return [(c as Extract<Command, { type: "addEndpoint" }>).endpoint.id];
    case "updateStory": case "removeStory": case "removeEntity": case "removeScreen": case "updateScreen":
      return [(c as { id: string }).id];
    case "updateField": case "removeField": return [(c as { id: string }).id];
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
