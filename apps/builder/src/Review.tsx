import type { Command, Issue, ScreenPlan, Spec, StaleItem } from "./api";
import { DescribeChange } from "./Recommendations";
import { allFlags } from "./sheet/rules";
import type { Spot } from "./sheet/Grid";
import { Empty } from "./ui";

type Screen = Spec["screens"][number];

/** The planner's questions that only a person can answer, in words. */
const QUESTION_LABEL: Record<string, string> = { "shows-totals": "A totals strip" };

/** What the checks found, cell by cell, each one a link back to where it can be fixed. */
export function Health({ spec, issues, onJump }: { spec: Spec; issues: Issue[]; onJump: (tab: string, spot?: Spot) => void }) {
  const flags = allFlags(spec);
  const bad = flags.filter((f) => f.flag.level === "bad");
  const warn = flags.filter((f) => f.flag.level === "warn");
  const errors = issues.filter((i) => i.severity === "error");
  return (
    <div className="dock-body">
      <h2>Health</h2>
      <p className="hint">{bad.length + errors.length} to fix, {warn.length} to look at. None of these stop you typing.</p>
      {errors.map((i, n) => <p key={n} className="health bad"><code>{i.path}</code> {i.message}</p>)}
      {[...bad, ...warn].map((f) => (
        <button key={`${f.tab}${f.rowId}${f.col}`} className={`health ${f.flag.level}`} onClick={() => onJump(f.tab, { rowId: f.rowId, col: f.col })}>
          <small>{f.tabName}</small>{f.flag.why}
        </button>
      ))}
      {!bad.length && !warn.length && !errors.length && <Empty>Nothing to fix.</Empty>}
    </div>
  );
}

/** Why each page is built the way it is, what only a person can decide, and what a change to the stories left behind. */
export function Review({ id, aiEnabled, spec, plan, stale, send, tell, canEdit }: { id: string; aiEnabled: boolean; spec: Spec; plan: ScreenPlan[]; stale: StaleItem[]; send: (c: Command[]) => Promise<boolean>; tell: (t: string) => void; canEdit: boolean }) {
  const decide = (s: Screen, question: string, answer: boolean) => {
    const because = s.stories.slice(0, 1);
    if (answer && !because.length) return tell("Link this screen to a story first: a yes has to say which story it serves.");
    void send([{
      type: "updateScreen", id: s.id,
      patch: { bento: { ...s.bento, [question]: { answer, because: answer ? because : [], provenance: { source: "human", storyRefs: because, degraded: false } } } },
    }]);
  };

  return (
    <div className="dock-body">
      <h2>Review</h2>
      {canEdit && <DescribeChange id={id} enabled={aiEnabled} send={send} />}
      {stale.length > 0 && (
        <section className="review-block">
          <h3>Stories changed since these were decided</h3>
          {stale.map((x) => (
            <div key={x.key} className="stale">
              <span><b>{x.what}</b> {x.why}</span>
              {canEdit && <button onClick={() => void send(x.stillRight)}>Still right</button>}
            </div>
          ))}
        </section>
      )}
      {spec.screens.length === 0 && <Empty>No screens yet.</Empty>}
      {spec.screens.map((s) => {
        const p = plan.find((x) => x.screen === s.id);
        const slots = p ? [...new Set(p.items.map((i) => i.slot))] : [];
        const undecided = p ? Object.entries(p.answers).filter(([, a]) => a.answer === "undecided") : [];
        return (
          <section key={s.id} className="review-block">
            <h3>{s.title} <code>{s.path}</code></h3>
            {p && <p className="hint">{p.layout}: {p.layoutWhy}</p>}
            {undecided.map(([q]) => (
              <div key={q} className="decide">
                <span><b>{QUESTION_LABEL[q] ?? q}</b>: no rule can tell whether this is wanted.</span>
                {canEdit && <span className="inline"><button onClick={() => decide(s, q, true)}>Yes, add it</button><button onClick={() => decide(s, q, false)}>No</button></span>}
              </div>
            ))}
            {p && p.placeholders.length > 0 && (
              <div className="devneeded">
                <b>Needs a developer</b>
                <ul>{p.placeholders.map((x, n) => <li key={n}>{x.what}: {x.why}</li>)}</ul>
              </div>
            )}
            {p && (
              <details className="more">
                <summary>{p.items.length} parts and why</summary>
                {slots.map((slot) => (
                  <div key={slot} className="slot">
                    <b>{slot}</b>
                    <ul>{p.items.filter((i) => i.slot === slot).map((i, n) => <li key={n}><code>{i.part}</code> {i.why}</li>)}</ul>
                  </div>
                ))}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
