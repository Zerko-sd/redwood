import { useEffect, useState } from "react";
import { api, type ChangeOp, type Command, type Recommendation } from "./api";
import { Empty } from "./ui";

const GROUP: Record<Recommendation["group"], string> = { security: "Security", tenancy: "Organisations", privacy: "Privacy", coverage: "Gaps in your stories" };
const STATUS: Record<Recommendation["status"], string> = { built: "Built in", partly: "Partly built", spec: "Not generated yet" };
const hiddenKey = (id: string) => `redwood.hidden-recommendations.${id}`;

/** Stories the spec is probably missing. No model is involved, so the same spec always gets the same advice. */
export function Recommendations({ id, rev, send, canEdit }: { id: string; rev: number; send: (c: Command[]) => Promise<boolean>; canEdit: boolean }) {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(hiddenKey(id)) ?? "[]") as string[]; } catch { return []; }
  });
  useEffect(() => void api.recommendations(id).then(setItems).catch(() => setItems([])), [id, rev]);

  const hide = (rec: string) => {
    const next = [...hidden, rec];
    setHidden(next);
    try { localStorage.setItem(hiddenKey(id), JSON.stringify(next)); } catch { /* it comes back next visit */ }
  };
  const shown = items.filter((r) => !hidden.includes(r.id));

  return (
    <div className="dock-body">
      <h2>Stories you may be missing</h2>
      <p className="hint">Read from your stories and roles. Each one says what the generated app really does today.</p>
      {shown.length === 0 && <Empty>Nothing to suggest.</Empty>}
      {(Object.keys(GROUP) as Recommendation["group"][]).map((g) => {
        const list = shown.filter((r) => r.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="review-block">
            <h3>{GROUP[g]}</h3>
            {list.map((r) => (
              <article key={r.id} className="rec">
                <p><b>{r.role}:</b> {r.story}</p>
                <p className="hint small"><span className={`rec-status ${r.status}`}>{STATUS[r.status]}</span> {r.why}{r.newRole ? ` Adds the role ${r.role}.` : ""}</p>
                {canEdit && (
                  <span className="inline">
                    <button onClick={() => void send(r.commands)}>Add story</button>
                    <button className="ghost" onClick={() => hide(r.id)}>Hide</button>
                  </span>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Says a change in words; the model turns it into steps, and only the ticked ones are applied. */
export function DescribeChange({ id, enabled, send }: { id: string; enabled: boolean; send: (c: Command[]) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [ops, setOps] = useState<ChangeOp[] | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.describeChange(id, text.trim());
      setOps(r);
      setTicked(r.map((_, i) => i));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (await send((ops ?? []).filter((_, i) => ticked.includes(i)).flatMap((o) => o.commands))) { setOps(null); setText(""); }
  };

  return (
    <section className="review-block">
      <h3>Describe a change to your screens</h3>
      {!enabled && <p className="hint small">This needs a model. Put <code>NEBIUS_API_KEY</code> in <code>.env</code>.</p>}
      <textarea rows={2} aria-label="Change" placeholder="Add a page listing trips, and hide Capacity on Buses" value={text} disabled={!enabled} onChange={(e) => setText(e.target.value)} />
      <span className="inline"><button disabled={!enabled || !text.trim() || busy} onClick={() => void ask()}>{busy ? "Working it out…" : "Work it out"}</button></span>
      {error && <p className="error small">{error}</p>}
      {ops && ops.length === 0 && <p className="muted small">That needs no change.</p>}
      {ops && ops.length > 0 && (
        <>
          {ops.map((o, i) => (
            <label key={o.line} className="check">
              <input type="checkbox" checked={ticked.includes(i)} onChange={(e) => setTicked(e.target.checked ? [...ticked, i] : ticked.filter((x) => x !== i))} /> {o.line}
            </label>
          ))}
          <span className="inline"><button className="primary" disabled={!ticked.length} onClick={() => void apply()}>Apply</button><button className="ghost" onClick={() => setOps(null)}>Cancel</button></span>
        </>
      )}
    </section>
  );
}
