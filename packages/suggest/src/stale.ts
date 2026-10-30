import type { Command, Provenance, Spec } from "@redwood/spec";
import { hash } from "./util";

export interface StaleItem {
  key: string;
  step: "data" | "endpoints";
  what: string;
  why: string;
  /** Records that a person looked and it still holds. Regenerating is the other way out. */
  stillRight: Command[];
}

const actions = (spec: Spec, refs: string[]) => spec.stories.filter((s) => refs.includes(s.id)).map((s) => s.action);
const lost = (spec: Spec, p: Provenance) => p.storyRefs.some((r) => !spec.stories.some((s) => s.id === r));
const why = (spec: Spec, p: Provenance) => (lost(spec, p) ? "A story it came from was removed." : "A story it came from has changed.");
const refreshed = (spec: Spec, p: Provenance, inputHash: string): Provenance => ({
  ...p, inputHash, storyRefs: p.storyRefs.filter((r) => spec.stories.some((s) => s.id === r)),
});

/**
 * What was worked out from stories that have since changed. Each decision keeps a hash of the stories it read, so
 * this compares what was read with what is there now. Hand-made decisions carry no hash and are never stale.
 */
export function staleItems(spec: Spec): StaleItem[] {
  const out: StaleItem[] = [];
  for (const e of spec.entities) {
    const p = e.provenance;
    if (p?.inputHash) {
      const story = spec.stories.find((s) => s.id === p.storyRefs[0]);
      const now = story ? hash(story.action, story.role) : "";
      if (now !== p.inputHash) {
        out.push({
          key: `entity:${e.id}`, step: "data", what: `Table ${e.name}`, why: why(spec, p),
          stillRight: [{ type: "updateEntity", id: e.id, patch: { provenance: refreshed(spec, p, now) } }],
        });
      }
    }
    const fields = e.fields.filter((f) => f.provenance?.inputHash && f.provenance.inputHash !== hash(actions(spec, f.provenance.storyRefs)));
    if (fields.length) {
      out.push({
        key: `fields:${e.id}`, step: "data", what: `Fields of ${e.name}`, why: why(spec, fields[0]!.provenance!),
        stillRight: fields.map((f) => {
          const pf = f.provenance!;
          return { type: "updateField", entity: e.id, id: f.id, patch: { provenance: refreshed(spec, pf, hash(actions(spec, pf.storyRefs))) } };
        }),
      });
    }
    const endpoints = spec.endpoints.filter((ep) => ep.entity === e.id && ep.provenance?.inputHash && ep.provenance.inputHash !== hash(actions(spec, ep.provenance.storyRefs)));
    if (endpoints.length) {
      out.push({
        key: `endpoints:${e.id}`, step: "endpoints", what: `What ${e.name} pages can do`, why: why(spec, endpoints[0]!.provenance!),
        stillRight: endpoints.map((ep) => {
          const pe = ep.provenance!;
          return { type: "updateEndpoint", id: ep.id, patch: { provenance: refreshed(spec, pe, hash(actions(spec, pe.storyRefs))) } };
        }),
      });
    }
  }
  return out;
}
