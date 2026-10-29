import { useState } from "react";
import { LAYOUTS } from "@redwood/parts";
import { OPERATIONS } from "@redwood/spec/src/schema";
import { freshId, slug, type Command, type ScreenPlan, type Spec } from "./api";
import { Empty, Section, Select, Text, nameOf, type EditorProps } from "./ui";

type Screen = Spec["screens"][number];
const AUTO = "";

/** The planner's questions that only a person can answer, in words. */
const QUESTION_LABEL: Record<string, string> = { "shows-totals": "A totals strip (StatCards)" };

export function Screens({ spec, send, tell, canEdit, plan }: EditorProps & { plan: ScreenPlan[] }) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [entity, setEntity] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const addScreen = async () => {
    const t = title.trim();
    const p = (path.trim() || `/${slug(t)}`);
    if (!t) return;
    if (!p.startsWith("/")) return tell('A path starts with "/", for example /buses');
    const commands: Command[] = [];
    const endpointIds: string[] = [];
    const taken = spec.endpoints.map((e) => e.id);
    if (entity) {
      // A screen over a table gets that table's CRUD operations; reuse any that already exist.
      for (const op of OPERATIONS) {
        const have = spec.endpoints.find((e) => e.entity === entity && e.operation === op);
        if (have) { endpointIds.push(have.id); continue; }
        const id = freshId("endpoint", `${slug(entity.replace(/^entity:/, ""))}-${op}`, taken);
        taken.push(id);
        endpointIds.push(id);
        commands.push({ type: "addEndpoint", endpoint: { id, entity, operation: op, guards: [] } });
      }
    }
    const id = freshId("screen", t, spec.screens.map((s) => s.id));
    commands.push({
      type: "addScreen",
      screen: { id, title: t, path: p, ...(entity ? { entity } : {}), stories: picked, endpoints: endpointIds, blocks: [], bento: {}, roles: [] },
    });
    if (await send(commands)) { setTitle(""); setPath(""); setEntity(""); setPicked([]); }
  };

  const decide = (s: Screen, question: string, answer: boolean) => {
    const because = s.stories.slice(0, 1);
    if (answer && !because.length) return tell("Link this screen to a story first: a yes has to say which story it serves.");
    void send([{
      type: "updateScreen", id: s.id,
      patch: { bento: { ...s.bento, [question]: { answer, because: answer ? because : [], provenance: { source: "human", storyRefs: because, degraded: false } } } },
    }]);
  };

  return (
    <>
      <Section title="Pages" hint="Each page is a layout filled with parts. Every part says which story asked for it. Pick the layout, or leave it on automatic.">
        {spec.screens.length === 0 && <Empty>No screens yet. Add one below, or add stories and tables first.</Empty>}
        {spec.screens.map((s) => {
          const p = plan.find((x) => x.screen === s.id);
          const slots = p ? [...new Set(p.items.map((i) => i.slot))] : [];
          const undecided = p ? Object.entries(p.answers).filter(([, a]) => a.answer === "undecided") : [];
          return (
            <article key={s.id} className="card">
              <header className="card-head">
                <Text label="Title" value={s.title} disabled={!canEdit} onCommit={(v) => void send([{ type: "updateScreen", id: s.id, patch: { title: v } }])} />
                <Text label="Path" value={s.path} disabled={!canEdit} onCommit={(v) => v.startsWith("/") ? void send([{ type: "updateScreen", id: s.id, patch: { path: v } }]) : tell('A path starts with "/"')} />
                <span className="muted">{s.entity ? nameOf(spec.entities, s.entity) : "no table"}</span>
                {canEdit && <button className="ghost danger" onClick={() => void send([{ type: "removeScreen", id: s.id }])}>Remove</button>}
              </header>

              <div className="row">
                <label>Layout
                  <Select
                    label="Layout"
                    value={s.layout ?? AUTO}
                    disabled={!canEdit}
                    options={[{ value: AUTO, label: "Automatic" }, ...Object.keys(LAYOUTS).map((k) => ({ value: k, label: k }))]}
                    onChange={(v) => void send([{ type: "updateScreen", id: s.id, patch: { layout: v || undefined } }])}
                  />
                </label>
                {p && <span className="muted">{p.layout}: {p.layoutWhy}</span>}
              </div>

              <div className="row">
                <span className="muted">Serves</span>
                {s.stories.length ? s.stories.map((id) => <span key={id} className="chip small">{spec.stories.find((x) => x.id === id)?.action ?? id}</span>) : <span className="gap">no story yet</span>}
              </div>
              {canEdit && spec.stories.length > 0 && (
                <details className="more">
                  <summary>Choose stories</summary>
                  <div className="checks">
                    {spec.stories.map((st) => (
                      <label key={st.id}>
                        <input
                          type="checkbox"
                          checked={s.stories.includes(st.id)}
                          onChange={(e) => void send([{ type: "updateScreen", id: s.id, patch: { stories: e.target.checked ? [...s.stories, st.id] : s.stories.filter((x) => x !== st.id) } }])}
                        />
                        {nameOf(spec.roles, st.role)}: {st.action}
                      </label>
                    ))}
                  </div>
                </details>
              )}

              {p && (
                <details className="more">
                  <summary>{p.items.length} parts and why</summary>
                  {slots.map((slot) => (
                    <div key={slot} className="slot">
                      <b>{slot}</b>
                      <ul>
                        {p.items.filter((i) => i.slot === slot).map((i, n) => <li key={n}><code>{i.part}</code> {i.why}</li>)}
                      </ul>
                    </div>
                  ))}
                </details>
              )}

              {undecided.map(([q]) => (
                <div key={q} className="decide">
                  <span><b>{QUESTION_LABEL[q] ?? q}</b>: no rule can tell whether this is wanted.</span>
                  {canEdit && <><button onClick={() => decide(s, q, true)}>Yes, add it</button><button onClick={() => decide(s, q, false)}>No</button></>}
                </div>
              ))}

              {p && p.placeholders.length > 0 && (
                <div className="devneeded">
                  <b>Needs a developer</b>
                  <ul>{p.placeholders.map((x, n) => <li key={n}>{x.what}: {x.why}</li>)}</ul>
                </div>
              )}
            </article>
          );
        })}
      </Section>

      {canEdit && (
        <Section title="Add a page">
          <form className="add-grid" onSubmit={(e) => { e.preventDefault(); void addScreen(); }}>
            <input aria-label="Page title" placeholder="Title, e.g. Buses" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input aria-label="Path" placeholder={title ? `/${slug(title)}` : "/path"} value={path} onChange={(e) => setPath(e.target.value)} />
            <Select label="Table" value={entity} options={[{ value: "", label: "No table" }, ...spec.entities.map((e) => ({ value: e.id, label: e.name }))]} onChange={setEntity} />
            <button className="primary" disabled={!title.trim()}>Add page</button>
            {spec.stories.length > 0 && (
              <div className="checks wide-row">
                <span className="muted">Serves</span>
                {spec.stories.map((st) => (
                  <label key={st.id}>
                    <input type="checkbox" checked={picked.includes(st.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, st.id] : picked.filter((x) => x !== st.id))} />
                    {st.action}
                  </label>
                ))}
              </div>
            )}
          </form>
        </Section>
      )}
    </>
  );
}
