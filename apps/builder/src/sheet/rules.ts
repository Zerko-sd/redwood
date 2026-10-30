import type { Spec } from "../api";
import { norm, specToRows, tabsFor } from "./bind";

export interface Flag {
  level: "bad" | "warn";
  /** Shown on hover: a flagged cell always says why. */
  why: string;
}
export const flagKey = (rowId: string, col: string) => `${rowId}\0${col}`;

/** Checks that never block typing: what a person should look at, cell by cell. */
export function flagsFor(spec: Spec, tab: string): Map<string, Flag> {
  const out = new Map<string, Flag>();
  const flag = (rowId: string, col: string, level: Flag["level"], why: string) => {
    const at = flagKey(rowId, col);
    if (out.get(at)?.level !== "bad") out.set(at, { level, why });
  };

  if (tab === "roles") {
    const seen = new Map<string, string>();
    for (const r of spec.roles) {
      if (seen.has(norm(r.name))) flag(r.id, "name", "bad", `The same name as ${seen.get(norm(r.name))}. Two roles can't share a name.`);
      seen.set(norm(r.name), r.id);
      const groups = spec.subProjects.filter((s) => s.roles.includes(r.id));
      if (groups.length > 1) flag(r.id, "subProjects", "warn", `This role works in ${groups.length} sub-projects. That is fine if it is on purpose.`);
    }
  }

  if (tab === "stories") {
    for (const s of spec.stories) {
      if (s.subProject) {
        const group = spec.subProjects.find((x) => norm(x.name) === norm(s.subProject!));
        if (!group) flag(s.id, "subProject", "bad", `No role is in a sub-project called "${s.subProject}".`);
        else if (group.roles.length && !group.roles.includes(s.role)) flag(s.id, "role", "bad", `This role isn't in ${group.name}.`);
      }
      if (!spec.screens.some((sc) => sc.stories.includes(s.id))) flag(s.id, "path", "warn", "No page serves this story yet.");
    }
  }

  if (tab === "data") {
    for (const e of spec.entities) {
      if (!e.fields.length) flag(`${e.id}|`, "name", "warn", "This table has no fields yet, so it can't store anything.");
      const seen = new Set<string>();
      for (const f of e.fields) {
        if (seen.has(norm(f.name))) flag(`${e.id}|${f.id}`, "name", "bad", "Two fields in one table can't share a name.");
        seen.add(norm(f.name));
      }
    }
  }

  if (tab === "screens") {
    const paths = new Map<string, string[]>();
    for (const s of spec.screens) paths.set(s.path, [...(paths.get(s.path) ?? []), s.id]);
    for (const ids of paths.values()) {
      if (ids.length > 1) for (const id of ids) flag(id, "path", "bad", "Another screen already uses this path.");
    }
    for (const s of spec.screens) {
      if (!s.entity) flag(s.id, "entity", "warn", "A screen with no table shows a placeholder.");
      if (!s.stories.length) flag(s.id, "stories", "warn", "This screen serves no story.");
    }
  }

  if (tab === "endpoints") {
    for (const ep of spec.endpoints) {
      if (!spec.screens.some((s) => s.endpoints.includes(ep.id))) flag(ep.id, "screens", "warn", "No screen uses this endpoint, so nothing in the app can reach it.");
      if (ep.operation === "custom") flag(ep.id, "action", "warn", "Redwood has no template for a custom action. A developer builds it in custom/routes.ts.");
    }
  }

  const sample = spec.entities.find((e) => `rows:${e.id}` === tab);
  if (sample) {
    const rows = specToRows(spec, tab);
    for (const row of rows) {
      for (const f of sample.fields) {
        if (f.required && !row.cells[f.id]) flag(row.id, f.id, "bad", `${f.name} is required. The preview skips a row with this empty.`);
      }
    }
    for (const f of sample.fields.filter((x) => x.unique)) {
      const seen = new Set<string>();
      for (const row of rows) {
        const v = row.cells[f.id];
        if (v && seen.has(v)) flag(row.id, f.id, "bad", `${f.name} is unique, and another row already has this value.`);
        if (v) seen.add(v);
      }
    }
  }
  return out;
}

/** Everything flagged across the workbook, for the Health and Review panels. */
export function allFlags(spec: Spec): { tab: string; tabName: string; rowId: string; col: string; flag: Flag }[] {
  return tabsFor(spec).flatMap((t) =>
    [...flagsFor(spec, t.id)].map(([key, flag]) => {
      const [rowId, col] = key.split("\0") as [string, string];
      return { tab: t.id, tabName: t.name, rowId, col, flag };
    }),
  );
}
