import type { Spec, Suggestion } from "./api";
import type { SuggestionsState } from "./useSuggestions";

const STEP_LABEL: Record<Suggestion["step"], string> = {
  place: "Where a story lives", fields: "What a table stores", operations: "What a page can do",
  audience: "Who opens a page", access: "Who can do what", rules: "Status buttons and own records", services: "What an action relies on", theme: "The look",
};

export function Suggestions({ s, spec, canEdit }: { s: SuggestionsState; spec: Spec; canEdit: boolean }) {
  const { ai, phase, current, message, applied } = s;
  const unplaced = spec.stories.filter((st) => !spec.screens.some((sc) => sc.stories.includes(st.id))).length;
  const off = !ai?.enabled || phase === "asking" || !spec.stories.length;

  if (!canEdit) return null;
  if (ai && !ai.enabled && spec.stories.length === 0) return null;

  return (
    <section className="suggest" aria-label="Build from stories">
      <h2>Build from your stories</h2>
      <p className="hint">
        {unplaced > 0 ? `${unplaced} ${unplaced === 1 ? "story isn't" : "stories aren't"} on a page yet. ` : ""}
        You accept each pick; the app is generated without the model.
      </p>
      {phase === "building" ? (
        <button className="wide-btn" onClick={s.halt}>Stop</button>
      ) : (
        <div className="suggest-actions">
          <button disabled={off} onClick={() => void s.next()}>Suggest next</button>
          <button className="primary" disabled={off} onClick={() => void s.buildAll()}>Build it all</button>
        </div>
      )}

      {ai && !ai.enabled && <p className="notice-inline">Suggestions are off: no model is configured. Put <code>NEBIUS_API_KEY</code> in <code>.env</code> and restart the server.</p>}
      {ai?.enabled && ai.model && <p className="hint small">Model: {ai.model}</p>}
      {phase === "asking" && <p className="muted small">Working out the next step…</p>}
      {phase === "building" && <p className="muted small">{applied} accepted so far{current ? `: ${current.title}` : ""}…</p>}
      {message && phase !== "building" && <p className={`small ${ai?.enabled === false || /fail|answered|not configured|No model/i.test(message) ? "error" : "muted"}`}>{message}</p>}

      {current && phase === "showing" && (
        <article className={`suggestion${current.problem ? " problem" : ""}`}>
          <span className="suggestion-step">{STEP_LABEL[current.step]}</span>
          <strong>{current.title}</strong>
          {current.problem ? (
            <p className="error small">The model could not give a usable answer: {current.problem}. Try again, or skip this and decide it yourself.</p>
          ) : (
            <ul>{current.lines.map((l, n) => <li key={n}>{l}</li>)}</ul>
          )}
          <span className="hint small">{current.source === "ai" ? `From ${current.model ?? "the model"}` : "From your stories, no model"}</span>
          <div className="suggest-actions">
            {current.problem
              ? <button className="primary" onClick={() => void s.next()}>Try again</button>
              : <button className="primary" onClick={() => void s.accept(current)}>Accept</button>}
            <button onClick={() => void s.skip(current)}>Skip</button>
          </div>
          {!current.problem && <button className="ghost" onClick={s.dismiss}>Decide myself</button>}
          {!current.problem && <span className="hint small">In the sheet: Enter accepts, Esc skips.</span>}
        </article>
      )}
    </section>
  );
}
