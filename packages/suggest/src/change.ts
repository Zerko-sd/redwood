import { LAYOUTS } from "@redwood/parts";
import { OPERATIONS, type Command, type Spec } from "@redwood/spec";
import { LlmBadOutput, type LlmClient } from "./llm";
import { freshId, slug } from "./util";

/** One step of a described change. The person ticks the ones they want; nothing is applied until then. */
export interface ChangeOp { line: string; commands: Command[] }

export function changePrompt(instruction: string, spec: Spec): string {
  const screens = spec.screens.map((s) => {
    const e = spec.entities.find((x) => x.id === s.entity);
    const fields = s.fields.map((f) => e?.fields.find((x) => x.id === f)?.name ?? f);
    return `- ${s.path} "${s.title}": layout ${s.layout ?? "(inferred)"}, fields ${fields.join(", ") || "(all)"}${e ? `; table ${e.name} with columns: ${e.fields.map((f) => f.name).join(", ")}` : "; no table"}`;
  });
  return [
    `Request: "${instruction}"`,
    `Current screens:\n${screens.join("\n") || "(no screens yet)"}`,
    `Tables: ${spec.entities.map((e) => e.name).join(", ") || "(none)"}`,
    `Layouts:\n${Object.entries(LAYOUTS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
    "Turn the request into the smallest list of operations on the screens. Operations:\n" +
      "- add_screen: path (lowercase, starts with /), title, table (an existing table, or empty), layout\n" +
      "- remove_screen: path\n" +
      "- set_layout: path, layout\n" +
      "- add_fields / remove_fields: path, fields (only that screen's table's columns)",
    "Only change what the request asks for. Use an existing screen's exact path. If the request needs no change, respond with an empty ops list.",
  ].join("\n\n");
}

export const CHANGE_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add_screen", "remove_screen", "set_layout", "add_fields", "remove_fields"] },
          path: { type: "string" }, title: { type: "string" }, table: { type: "string" }, layout: { type: "string" },
          fields: { type: "array", items: { type: "string" } },
        },
        required: ["op", "path"],
      },
    },
  },
  required: ["ops"],
};

/** Turns the model's answer into commands, refusing anything outside the spec's own names. */
export function resolveChange(spec: Spec, raw: Record<string, unknown>): ChangeOp[] {
  if (!Array.isArray(raw.ops)) throw new LlmBadOutput("ops missing");
  const out: ChangeOp[] = [];
  for (const o of raw.ops as Record<string, unknown>[]) {
    const path = typeof o.path === "string" ? o.path.trim() : "";
    const screen = spec.screens.find((s) => s.path === path);
    const layout = typeof o.layout === "string" && Object.hasOwn(LAYOUTS, o.layout) ? o.layout : undefined;
    if (o.op === "add_screen") {
      if (!path.startsWith("/") || screen) continue;
      const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : path.slice(1) || "Home";
      const entity = spec.entities.find((e) => e.name === o.table);
      const endpoints = entity ? spec.endpoints.filter((e) => e.entity === entity.id).map((e) => e.id) : [];
      const taken = spec.endpoints.map((e) => e.id);
      const made: Command[] = [];
      if (entity && !endpoints.length) {
        for (const operation of OPERATIONS) {
          const id = freshId("endpoint", `${slug(entity.name)}-${operation}`, taken);
          taken.push(id);
          endpoints.push(id);
          made.push({ type: "addEndpoint", endpoint: { id, entity: entity.id, operation, guards: [], services: [] } });
        }
      }
      out.push({
        line: `Add ${title} at ${path}${entity ? ` over ${entity.name}` : ""}`,
        commands: [...made, {
          type: "addScreen",
          screen: { id: freshId("screen", title, spec.screens.map((s) => s.id)), title, path, ...(entity ? { entity: entity.id } : {}), ...(layout ? { layout } : {}), stories: [], endpoints, blocks: [], bento: {}, roles: [], fields: [], placement: "nav" },
        }],
      });
      continue;
    }
    if (!screen) continue;
    if (o.op === "remove_screen") out.push({ line: `Remove ${screen.title}`, commands: [{ type: "removeScreen", id: screen.id }] });
    if (o.op === "set_layout" && layout) out.push({ line: `Show ${screen.title} as ${layout}`, commands: [{ type: "updateScreen", id: screen.id, patch: { layout } }] });
    if (o.op === "add_fields" || o.op === "remove_fields") {
      const e = spec.entities.find((x) => x.id === screen.entity);
      const names = Array.isArray(o.fields) ? (o.fields as unknown[]).map(String) : [];
      const ids = (e?.fields ?? []).filter((f) => names.includes(f.name)).map((f) => f.id);
      if (!e || !ids.length) continue;
      const all = e.fields.map((f) => f.id);
      const now = screen.fields.length ? screen.fields : all;
      const next = o.op === "add_fields" ? [...new Set([...now, ...ids])] : now.filter((f) => !ids.includes(f));
      const shown = (id: string) => e.fields.find((f) => f.id === id)!.name;
      out.push({ line: `${o.op === "add_fields" ? "Show" : "Hide"} ${ids.map(shown).join(", ")} on ${screen.title}`, commands: [{ type: "updateScreen", id: screen.id, patch: { fields: next } }] });
    }
  }
  return out;
}

export async function describeChange(spec: Spec, instruction: string, llm: LlmClient): Promise<ChangeOp[]> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return resolveChange(spec, (await llm.json(changePrompt(instruction, spec), CHANGE_SCHEMA)) as Record<string, unknown>);
    } catch (e) {
      if (!(e instanceof LlmBadOutput)) throw e;
      last = e;
    }
  }
  throw last;
}
