import { createHash } from "node:crypto";

/** Deterministic JSON: sorted object keys, no whitespace variance, LF-only. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sort(value), null, 2) + "\n";
}

function sort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sort(x);
    }
    return out;
  }
  return v;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function specHash(spec: unknown): string {
  return sha256(canonicalJson(spec));
}
