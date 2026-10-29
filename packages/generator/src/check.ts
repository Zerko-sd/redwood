import type { Issue, Spec } from "@redwood/spec";
import { LAYOUTS, THEMES, isLayout, isTheme } from "@redwood/parts";
import "./layouts";
import "./blocks";
import { getBlock, getLayout } from "./registry";

/**
 * What the spec asks for that the generator cannot provide: a layout or theme that does not exist, a layout that
 * needs something the entity lacks. The schema stays free of these names so adding a layout never changes it;
 * this is where a bad name is refused. (A *block* name is never an error: with no template it becomes a
 * developer file and a placeholder.)
 */
export function checkRegistries(spec: Spec): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, severity: "error" });

  spec.screens.forEach((s, i) => {
    if (!s.layout) return;
    if (!isLayout(s.layout)) {
      error(`screens.${i}.layout`, `unknown layout "${s.layout}"; choose one of: ${Object.keys(LAYOUTS).join(", ")}`);
      return;
    }
    if (s.layout === "board") {
      const entity = spec.entities.find((e) => e.id === s.entity);
      if (!entity?.workflow) error(`screens.${i}.layout`, `a board needs an entity with a workflow, and ${s.entity ?? "this screen"} has none`);
    }
  });
  if (!isTheme(spec.theme.preset)) {
    error("theme.preset", `unknown theme "${spec.theme.preset}"; choose one of: ${Object.keys(THEMES).join(", ")}`);
  }
  return issues;
}

/** Layouts the closed list names that have no renderer, or that use a block nobody registered. Used by tests. */
export function registryProblems(): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(LAYOUTS)) {
    const layout = getLayout(id);
    if (!layout) {
      problems.push(`layout "${id}" is in the closed list but has no renderer`);
      continue;
    }
    for (const ids of Object.values(layout.blocks)) {
      for (const b of ids) if (b !== "named-blocks" && !getBlock(b)) problems.push(`layout "${id}" uses unregistered block "${b}"`);
    }
  }
  return problems;
}
