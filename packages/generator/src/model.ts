import type { Entity, Spec } from "@redwood/spec";
import { columnName, snake, tableName } from "@redwood/migrations";
import { json } from "./util";

export const roleSlug = (id: string) => id.replace(/^role:/, "");

export class SpecError extends Error {}

export function findColumn(entity: Entity, fieldName: string, what: string): string {
  const f = entity.fields.find((x) => x.name === fieldName || columnName(x) === snake(fieldName));
  if (!f) throw new SpecError(`${entity.id}: ${what} "${fieldName}" is not a field of the entity`);
  return columnName(f);
}

/** The field that names a record in pickers and tables: first required text, else first text, else the first field. */
export function displayColumn(e: Entity): string {
  const f =
    e.fields.find((x) => x.type === "text" && x.required) ??
    e.fields.find((x) => x.type === "text") ??
    e.fields[0];
  return f ? columnName(f) : "id";
}

/** src/shared/model.ts: the entities as the server and the UI both see them. */
export function emitModel(spec: Spec): string {
  const models: Record<string, unknown> = {};
  const seeds: Record<string, unknown[]> = {};
  for (const e of spec.entities) {
    const table = tableName(e);
    models[table] = {
      table,
      label: e.name,
      display: displayColumn(e),
      columns: e.fields.map((f) => ({
        key: columnName(f),
        label: f.name,
        type: f.type,
        required: f.required,
        ...(f.default !== undefined ? { default: f.default } : {}),
        ...(f.options ? { options: f.options } : {}),
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
        ...(f.references ? { references: tableName(spec.entities.find((x) => x.id === f.references)!) } : {}),
      })),
      ...(e.workflow
        ? {
            workflow: {
              column: findColumn(e, e.workflow.field, "workflow field"),
              states: e.workflow.states,
            },
          }
        : {}),
    };
    if (e.seed.length) {
      seeds[table] = e.seed.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([id, v]) => [columnName(e.fields.find((f) => f.id === id)!), v]),
        ),
      );
    }
  }
  return `export interface Column {
  key: string;
  label: string;
  type: string;
  required: boolean;
  default?: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
  references?: string;
}

export interface Model {
  table: string;
  label: string;
  /** Column that names a record wherever another screen refers to it. */
  display: string;
  columns: Column[];
  workflow?: { column: string; states: string[] };
}

export const appTitle = ${json(spec.title)};

export const models: Record<string, Model> = ${json(models)};

export const seeds: Record<string, Record<string, unknown>[]> = ${json(seeds)};
`;
}

/** src/shared/policy.ts: the one access matrix, imported by both the API and the UI. Deny by default. */
export function emitPolicy(spec: Spec): string {
  const entities = new Map(spec.entities.map((e) => [e.id, e]));
  const access: Record<string, Record<string, unknown>> = {};
  for (const r of spec.access) {
    const e = entities.get(r.entity)!;
    const role = roleSlug(r.role);
    (access[role] ??= {})[tableName(e)] = {
      ops: [...r.operations].sort(),
      ...(r.ownerField ? { owner: findColumn(e, r.ownerField, "ownerField") } : {}),
      hidden: r.hiddenFields.map((h) => findColumn(e, h, "hidden field")).sort(),
    };
  }
  const workflows: Record<string, unknown> = {};
  for (const e of spec.entities) {
    if (!e.workflow) continue;
    workflows[tableName(e)] = {
      column: findColumn(e, e.workflow.field, "workflow field"),
      transitions: e.workflow.transitions.map((t) => ({ from: t.from, to: t.to, roles: t.roles.map(roleSlug) })),
    };
  }
  return `export const roles = ${json(spec.roles.map((r) => roleSlug(r.id)))} as const;

export type Op = "list" | "read" | "create" | "update" | "delete";

interface Grant {
  ops: Op[];
  owner?: string;
  hidden: string[];
}

const access: Record<string, Record<string, Grant>> = ${json(access)};

const workflows: Record<string, { column: string; transitions: { from: string; to: string; roles: string[] }[] }> = ${json(workflows)};

const grant = (role: string, table: string): Grant | undefined => access[role]?.[table];

export const can = (role: string, table: string, op: Op): boolean => !!grant(role, table)?.ops.includes(op);

/** Column a row must match the signed-in username on, for row-level rules. */
export const ownerColumn = (role: string, table: string): string | undefined => grant(role, table)?.owner;

export const hiddenColumns = (role: string, table: string): string[] => grant(role, table)?.hidden ?? [];

export const canTransition = (role: string, table: string, from: string, to: string): boolean =>
  !!workflows[table]?.transitions.some((t) => t.from === from && t.to === to && t.roles.includes(role));

export const nextStates = (role: string, table: string, current: string): string[] =>
  (workflows[table]?.transitions ?? []).filter((t) => t.from === current && t.roles.includes(role)).map((t) => t.to);
`;
}
