import { createHash } from "node:crypto";

export const hash = (...parts: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 10);

/** `Plate Number!` -> `plate-number`. Mirrors the Builder's own helper so ids made on either side look alike. */
export const slug = (text: string): string =>
  text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export function freshId(kind: string, text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${kind}:${slug(text) || kind}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Comparison form of a name: `Camera Feed`, `camera_feed` and `CameraFeed` are one thing. */
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `CameraFeed` / `camera_feed` -> `Camera feed`. */
export function humanize(name: string): string {
  const words = name.replace(/[_\-/]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function plural(word: string): string {
  const w = word.trim();
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}

/** The path a table's list lives at when the model gave none, or gave one that cannot be used. */
export const defaultPath = (entityName: string): string => `/${slug(plural(entityName))}`;

/** A model-proposed path is trusted only when it looks like one: leading slash, lowercase kebab segments, no ids. */
export const isUsablePath = (v: unknown): v is string =>
  typeof v === "string" && /^\/[a-z0-9\-/]*$/.test(v.trim()) && !v.includes("//");

/** Names that describe an action rather than the thing acted on ("Create" for "I want to create user accounts"). */
export const VERB_ENTITIES = new Set([
  "create", "read", "update", "delete", "edit", "manage", "view", "add", "remove", "list", "get", "set", "save", "submit",
  "approve", "reject", "activate", "deactivate", "reactivate", "enable", "disable", "search", "upload", "download",
]);

/** A story that changes records. A read-only answer for one of these is wrong, not just cautious. */
export const WRITES = /\b(creat|tak|book|add|edit|updat|remov|delet|cancel|mark|schedul|assign|register|submit|record|log|set|change|move|approv|reject|manag|maintain|keep|enter|upload|import|send)\w*/i;
