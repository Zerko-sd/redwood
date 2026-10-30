import { spec, type Spec } from "./schema";

export interface Issue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

/** Structural parse (schema) followed by cross-reference checks the schema can't express. */
export function checkSpec(input: unknown): { spec?: Spec; issues: Issue[] } {
  const parsed = spec.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        severity: "error" as const,
      })),
    };
  }
  const s = parsed.data;
  const issues: Issue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });

  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) err(kind, `duplicate id ${x}`);
      seen.add(x);
    }
  };
  dup("roles", s.roles.map((r) => r.id));
  dup("stories", s.stories.map((r) => r.id));
  dup("entities", s.entities.map((r) => r.id));
  dup("screens", s.screens.map((r) => r.id));
  dup("endpoints", s.endpoints.map((r) => r.id));
  dup("services", s.services.map((r) => r.id));

  const roles = new Set(s.roles.map((r) => r.id));
  const stories = new Set(s.stories.map((r) => r.id));
  const entities = new Set(s.entities.map((r) => r.id));
  const endpoints = new Set(s.endpoints.map((r) => r.id));
  const services = new Set(s.services.map((r) => r.id));

  s.subProjects.forEach((sp, i) => {
    sp.roles.forEach((r) => !roles.has(r) && err(`subProjects.${i}.roles`, `unknown role ${r}`));
  });
  s.stories.forEach((st, i) => {
    if (!roles.has(st.role)) err(`stories.${i}.role`, `unknown role ${st.role}`);
  });
  s.entities.forEach((e, i) => {
    e.fields.forEach((f, j) => {
      const p = `entities.${i}.fields.${j}`;
      if (f.type === "reference" && (!f.references || !entities.has(f.references)))
        err(p, "reference field needs a known `references` entity");
      if (f.type === "choice" && !f.options?.length) err(p, "choice field needs `options`");
    });
    const fieldIds = new Set(e.fields.map((f) => f.id));
    dup(`entities.${i}.seed`, e.seed.flatMap((row) => (typeof row.id === "string" ? [row.id] : [])));
    e.seed.forEach((row, j) => {
      for (const k of Object.keys(row)) {
        if (k !== "id" && !fieldIds.has(k)) err(`entities.${i}.seed.${j}`, `seed key ${k} is not a field id of ${e.id}`);
      }
    });
    e.relationships.forEach((r, j) => {
      if (!entities.has(r.to)) err(`entities.${i}.relationships.${j}`, `unknown entity ${r.to}`);
    });
    if (e.workflow) {
      if (!e.fields.some((f) => f.name === e.workflow!.field)) err(`entities.${i}.workflow`, `workflow field "${e.workflow.field}" is not a field of ${e.id}`);
      const states = new Set(e.workflow.states);
      e.workflow.transitions.forEach((t, j) => {
        const p = `entities.${i}.workflow.transitions.${j}`;
        if (!states.has(t.from) || !states.has(t.to)) err(p, "transition uses an unknown state");
        t.roles.forEach((r) => !roles.has(r) && err(p, `unknown role ${r}`));
      });
    }
  });
  s.endpoints.forEach((ep, i) => {
    if (!entities.has(ep.entity)) err(`endpoints.${i}.entity`, `unknown entity ${ep.entity}`);
    if (ep.operation === "custom" && !ep.action) err(`endpoints.${i}`, "custom endpoint needs `action`");
    ep.services.forEach((x) => !services.has(x) && err(`endpoints.${i}.services`, `unknown service ${x}`));
  });
  s.screens.forEach((sc, i) => {
    if (sc.entity && !entities.has(sc.entity)) err(`screens.${i}.entity`, `unknown entity ${sc.entity}`);
    sc.stories.forEach((x) => !stories.has(x) && err(`screens.${i}.stories`, `unknown story ${x}`));
    sc.endpoints.forEach((x) => !endpoints.has(x) && err(`screens.${i}.endpoints`, `unknown endpoint ${x}`));
    sc.roles.forEach((x) => !roles.has(x) && err(`screens.${i}.roles`, `unknown role ${x}`));
    const shown = s.entities.find((e) => e.id === sc.entity);
    sc.fields.forEach((x) => !shown?.fields.some((f) => f.id === x) && err(`screens.${i}.fields`, `${x} is not a field of ${sc.entity ?? "this screen's table"}`));
    for (const [q, a] of Object.entries(sc.bento)) {
      if (a.answer && a.because.length === 0)
        err(`screens.${i}.bento.${q}`, 'a "yes" must cite at least one story');
      a.because.forEach((x) => !stories.has(x) && err(`screens.${i}.bento.${q}`, `unknown story ${x}`));
    }
    if (sc.stories.length === 0) warn(`screens.${i}`, "screen serves no story");
  });
  s.access.forEach((a, i) => {
    if (!roles.has(a.role)) err(`access.${i}.role`, `unknown role ${a.role}`);
    if (!entities.has(a.entity)) err(`access.${i}.entity`, `unknown entity ${a.entity}`);
    const target = s.entities.find((e) => e.id === a.entity);
    if (a.ownerField && target && !target.fields.some((f) => f.name === a.ownerField))
      err(`access.${i}.ownerField`, `"${a.ownerField}" is not a field of ${a.entity}`);
    for (const name of a.readOnlyFields) {
      if (target && !target.fields.some((f) => f.name === name)) err(`access.${i}.readOnlyFields`, `"${name}" is not a field of ${a.entity}`);
    }
  });
  for (const st of s.stories) {
    if (!s.screens.some((sc) => sc.stories.includes(st.id)))
      warn(`stories.${st.id}`, "story is not served by any screen");
  }
  return { spec: s, issues };
}
