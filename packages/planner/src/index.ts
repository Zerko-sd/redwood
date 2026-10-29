import type { Spec, Screen, Entity } from "@redwood/spec";
import { isLayout, type LayoutId, type PartName, type SlotName } from "@redwood/parts";

export type Op = "list" | "read" | "create" | "update" | "delete";

export interface Answer {
  answer: boolean | "undecided";
  because: string[];
  source: "rule" | "saved";
}

export interface PlanItem {
  slot: SlotName;
  part: PartName;
  /** Operation the signed-in role must hold for this part to show. */
  requires?: Op;
  because: string[];
  why: string;
}

export interface ScreenPlan {
  screen: string;
  path: string;
  entity?: string;
  /** The page shape: the screen's saved choice if it can be honoured, else the rule's. */
  layout: LayoutId;
  /** Why the layout is what it is, in one line. */
  layoutWhy: string;
  /** Extra blocks the screen names. Redwood decides at generation time whether it has a template for each. */
  blocks: { id: string }[];
  answers: Record<string, Answer>;
  items: PlanItem[];
  /** Custom actions the spec gives this screen. Redwood has no template for them, so each is a visible gap. */
  actions: { endpoint: string; action: string; label: string }[];
  dropped: { part: PartName; why: string }[];
  placeholders: { what: string; why: string }[];
}

interface Question {
  id: string;
  /** Deterministic answer from the spec, or "undecided" when only a model/person can say. */
  rule(spec: Spec, screen: Screen, entity: Entity | undefined): boolean | "undecided";
}

const ops = (spec: Spec, screen: Screen) =>
  new Set(spec.endpoints.filter((e) => screen.endpoints.includes(e.id)).map((e) => e.operation));

export const QUESTIONS: Question[] = [
  { id: "lists-many", rule: (s, sc) => ops(s, sc).has("list") },
  // A listed record can be opened to see all of it; the pane reads rows the list already loaded.
  { id: "has-detail", rule: (s, sc) => ops(s, sc).has("list") },
  { id: "can-create", rule: (s, sc) => ops(s, sc).has("create") },
  { id: "can-edit", rule: (s, sc) => ops(s, sc).has("update") },
  { id: "can-delete", rule: (s, sc) => ops(s, sc).has("delete") },
  { id: "has-states", rule: (_s, _sc, e) => !!e?.workflow },
  {
    id: "searchable",
    rule: (s, sc, e) => ops(s, sc).has("list") && !!e?.fields.some((f) => f.type === "text"),
  },
  // Not answerable from the spec alone: left for a model or a person.
  { id: "shows-totals", rule: () => "undecided" },
];

export function planScreen(spec: Spec, screen: Screen): ScreenPlan {
  const entity = spec.entities.find((e) => e.id === screen.entity);
  const answers: Record<string, Answer> = {};
  for (const q of QUESTIONS) {
    const saved = screen.bento[q.id];
    answers[q.id] = saved
      ? { answer: saved.answer, because: saved.because, source: "saved" }
      : { answer: q.rule(spec, screen, entity), because: screen.stories, source: "rule" };
  }
  const yes = (id: string) => answers[id]?.answer === true;
  const cite = (id: string) => answers[id]?.because ?? [];

  const plan: ScreenPlan = {
    screen: screen.id, path: screen.path, entity: screen.entity,
    layout: "list", layoutWhy: "the default shape for a screen",
    blocks: screen.blocks.map((id) => ({ id })),
    answers, items: [], actions: [], dropped: [], placeholders: [],
  };
  const add = (i: PlanItem) => plan.items.push(i);
  const drop = (part: PartName, why: string) => plan.dropped.push({ part, why });

  add({ slot: "header", part: "Page", because: screen.stories, why: "every screen has a page header" });

  if (!entity) {
    plan.placeholders.push({ what: screen.id, why: "screen has no entity, so nothing to render without guessing" });
    add({ slot: "main", part: "EmptyState", because: screen.stories, why: "no entity bound" });
    return plan;
  }

  // ---- layout: a saved choice wins when it can be honoured; otherwise a rule picks.
  if (!yes("lists-many") && yes("can-create")) {
    plan.layout = "form-page";
    plan.layoutWhy = "the screen can create records but has nothing to list, so the form is the page";
  }
  if (screen.layout) {
    if (!isLayout(screen.layout)) {
      plan.placeholders.push({ what: `${screen.id}:layout`, why: `layout "${screen.layout}" does not exist; kept "${plan.layout}"` });
    } else if (screen.layout === "board" && !entity.workflow) {
      plan.placeholders.push({ what: `${screen.id}:layout`, why: `a board needs a workflow on ${entity.id}; kept "${plan.layout}"` });
    } else {
      plan.layout = screen.layout;
      plan.layoutWhy = "chosen for this screen";
    }
  }

  if (plan.layout === "form-page") {
    add({ slot: "main", part: "Form", requires: "create", because: cite("can-create"), why: "this screen only creates records, so the form is the page" });
    for (const id of plan.blocks.map((b) => b.id)) {
      plan.placeholders.push({ what: `${screen.id}:block:${id}`, why: `block "${id}" is named by the spec; a template is used if one exists, otherwise a developer file` });
    }
    return plan;
  }

  if (yes("lists-many")) {
    add({ slot: "toolbar", part: "Toolbar", requires: "list", because: cite("lists-many"), why: "a list needs somewhere for search and the record count" });
    add({
      slot: "main", part: plan.layout === "board" ? "Board" : "Table", requires: "list", because: cite("lists-many"),
      why: plan.layout === "board" ? "records are cards in one column per workflow state" : "screen has a list endpoint",
    });
  } else {
    add({ slot: "main", part: "EmptyState", because: screen.stories, why: "no list endpoint to show records" });
  }
  if (yes("searchable")) {
    add({ slot: "toolbar", part: "SearchBox", requires: "list", because: cite("searchable"), why: "list over a text field" });
  } else drop("SearchBox", "no list over a text field");

  const customOps = spec.endpoints.filter((e) => screen.endpoints.includes(e.id) && e.operation === "custom");
  if (yes("can-create") || yes("can-edit") || yes("can-delete") || customOps.length) {
    add({
      slot: "aside", part: "Dialog",
      because: [...cite("can-create"), ...cite("can-edit"), ...cite("can-delete")],
      why: "forms, delete confirmations and not-built notices open in a dialog, so the list stays in view",
    });
  } else drop("Dialog", "nothing on this screen needs a dialog");
  if (yes("can-create") || yes("can-edit")) {
    add({ slot: "aside", part: "Form", requires: yes("can-create") ? "create" : "update", because: [...cite("can-create"), ...cite("can-edit")], why: "screen can create or edit records" });
  } else drop("Form", "no create or update endpoint on this screen");
  if (yes("has-detail")) {
    add({ slot: "aside", part: "DetailPane", requires: "list", because: cite("has-detail"), why: "a listed record can be opened to see all of its fields" });
  }

  for (const ep of customOps) {
    const label = ep.action ?? ep.id;
    plan.actions.push({ endpoint: ep.id, action: label, label });
    plan.placeholders.push({ what: ep.id, why: `custom action "${label}" has no template; the button is shown and answers "not built yet"` });
  }

  if (yes("has-states")) {
    add({ slot: "toolbar", part: "StateButtons", requires: "update", because: screen.stories, why: "entity has a workflow" });
  }
  for (const b of plan.blocks) {
    plan.placeholders.push({ what: `${screen.id}:block:${b.id}`, why: `block "${b.id}" is named by the spec; a template is used if one exists, otherwise a developer file` });
  }
  if (answers["shows-totals"]?.answer === true) {
    add({ slot: "footer", part: "StatCards", requires: "list", because: cite("shows-totals"), why: "totals requested" });
  } else if (answers["shows-totals"]?.answer === "undecided") {
    drop("StatCards", "undecided: no rule can tell whether totals are wanted");
  }
  return plan;
}

export function planApp(spec: Spec): ScreenPlan[] {
  return spec.screens.map((s) => planScreen(spec, s));
}
