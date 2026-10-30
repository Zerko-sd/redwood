import type { Spec, StaleItem } from "./api";
import { allFlags } from "./sheet/rules";

export interface Step { id: string; tab: string; name: string; count: string; state: "none" | "partial" | "done" | "stale" }

/** The pipeline, read straight from the spec: nothing is locked, and a step's state is only what is in it. */
export function stepsOf(spec: Spec, stale: StaleItem[]): Step[] {
  const flags = allFlags(spec).filter((f) => f.flag.level === "bad");
  const bad = (tab: string) => flags.some((f) => f.tab === tab);
  const staleIn = (step: StaleItem["step"]) => stale.some((s) => s.step === step);
  const placed = spec.stories.filter((s) => spec.screens.some((sc) => sc.stories.includes(s.id))).length;
  const wired = spec.screens.filter((s) => s.endpoints.length > 0).length;
  const fields = spec.entities.reduce((n, e) => n + e.fields.length, 0);
  const linked = spec.endpoints.filter((e) => e.services.length).length;

  const state = (have: number, total: number, tab: string, step?: StaleItem["step"]): Step["state"] => {
    if (step && staleIn(step)) return "stale";
    if (!total) return "none";
    return have >= total && !bad(tab) ? "done" : "partial";
  };
  return [
    { id: "roles", tab: "roles", name: "Roles", count: String(spec.roles.length), state: state(spec.roles.length, spec.roles.length, "roles") },
    { id: "stories", tab: "stories", name: "Stories", count: spec.stories.length ? `${placed} of ${spec.stories.length} placed` : "0", state: state(placed, spec.stories.length, "stories") },
    { id: "data", tab: "data", name: "Data model", count: `${spec.entities.length} tables, ${fields} fields`, state: state(fields ? spec.entities.filter((e) => e.fields.length).length : 0, spec.entities.length, "data", "data") },
    { id: "screens", tab: "screens", name: "Screens", count: spec.screens.length ? `${wired} of ${spec.screens.length} working` : "0", state: state(wired, spec.screens.length, "screens") },
    { id: "endpoints", tab: "endpoints", name: "Endpoints", count: String(spec.endpoints.length), state: state(spec.endpoints.length, spec.endpoints.length, "endpoints", "endpoints") },
    { id: "services", tab: "endpoint-services", name: "Endpoint Services", count: `${linked} linked`, state: spec.services.length ? "done" : "none" },
  ];
}

const STATE_LABEL: Record<Step["state"], string> = { none: "Not started", partial: "In progress", done: "Done", stale: "Stories changed" };

export function Pipeline({ steps, tab, onTab }: { steps: Step[]; tab: string; onTab: (id: string) => void }) {
  return (
    <ol className="pipeline" aria-label="Steps">
      {steps.map((s) => (
        <li key={s.id}>
          <button className={s.tab === tab ? "on" : ""} onClick={() => onTab(s.tab)} title={STATE_LABEL[s.state]}>
            <span className={`step-dot ${s.state}`} aria-hidden />
            <span className="step-name">{s.name}</span>
            <span className="step-count">{s.count}</span>
            <span className="sr">{STATE_LABEL[s.state]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
