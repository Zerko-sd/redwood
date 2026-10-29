import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Output tree: relative POSIX path -> contents. Always emitted sorted, LF-only, newline-terminated. */
export type FileMap = Record<string, string>;

export const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\s+$/, "") + "\n";
}

export function sortedFiles(files: FileMap): FileMap {
  const out: FileMap = {};
  for (const k of Object.keys(files).sort()) out[k] = normalize(files[k]!);
  return out;
}

/** One hash for a whole tree, independent of insertion order. */
export function treeHash(files: FileMap): string {
  const h = createHash("sha256");
  for (const k of Object.keys(files).sort()) h.update(`${k}\0${sha(files[k]!)}\n`);
  return h.digest("hex");
}

export const template = (name: string) =>
  readFileSync(new URL(`../templates/${name}`, import.meta.url), "utf8");

export const json = (v: unknown) => JSON.stringify(v, null, 2);

/** `live-map` or `screen:buses` -> `LiveMap` / `Buses`. */
export const pascal = (id: string) =>
  id.replace(/^screen:/, "").split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");

/** URL- and package-safe lowercase name. Used for custom-action routes and the package name, which must agree. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
