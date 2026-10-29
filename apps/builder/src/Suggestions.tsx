import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Command, type Spec, type Suggestion } from "./api";

type Phase = "idle" | "asking" | "showing" | "building";

/** The first thing a suggestion's commands carry is where they came from; acceptance adds who said yes, and when. */
function stamp(commands: Command[], who: string): Command[] {
  const at = new Date().toISOString();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, k === "provenance" && x && typeof x === "object" ? { ...(x as object), acceptedBy: who, at } : walk(x)]),
      );
    }
    return v;
  };
  return walk(commands) as Command[];
}

const STEP_LABEL: Record<Suggestion["step"], string> = {
  place: "Where a story lives", fields: "What a table stores", operations: "What a page can do",
  audience: "Who opens a page", access: "Who can do what", rules: "Status buttons and own records", theme: "The look",
};

/**
 * Builds the spec from the stories, one open question at a time. Nothing is applied until it is accepted, and
 * "Build it all" is the same acceptance in a loop: every pick is still its own revision with its source recorded.
 */
export function Suggestions({ id, me, spec, send, canEdit }: { id: string; me: string; spec: Spec; send: (c: Command[]) => Promise<boolean>; canEdit: boolean }) {
  const [ai, setAi] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState(0);
  const stop = useRef(false);

  useEffect(() => void api.ai().then(setAi).catch(() => setAi({ enabled: false, model: null })), []);

  const unplaced = spec.stories.filter((s) => !spec.screens.some((sc) => sc.stories.includes(s.id))).length;

  /** Asks for the next question. Returns it, or null when there is nothing left or it could not be asked. */
  const ask = async (): Promise<Suggestion | null> => {
    try {
      const r = await api.suggestion(id);
      return r.suggestion;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : String(e));
      return null;
    }
  };

  const next = async () => {
    setMessage("");
    setPhase("asking");
    const s = await ask();
    setCurrent(s);
    setPhase(s ? "showing" : "idle");
    if (!s && !message) setMessage("Nothing left to suggest.");
  };

  const accept = async (s: Suggestion) => {
    if (!(await send(stamp(s.commands, me)))) return;
    setApplied((n) => n + 1);
    await next();
  };

  const skip = async (s: Suggestion) => {
    await api.skipSuggestion(id, s.key).catch(() => {});
    await next();
  };

  const buildAll = async () => {
    stop.current = false;
    setMessage("");
    setApplied(0);
    for (let i = 0; i < 80 && !stop.current; i++) {
      setPhase("building");
      const s = await ask();
      setCurrent(s);
      if (!s) { setPhase("idle"); setMessage("Done. Review each tab, then run the preview."); return; }
      // A question the model could not answer is left for a person; the loop never guesses past it.
      if (s.problem || !(await send(stamp(s.commands, me)))) { setPhase("showing"); return; }
      setApplied((n) => n + 1);
    }
    setPhase("idle");
    setMessage(stop.current ? "Stopped." : "Stopped after 80 steps.");
  };

  if (!canEdit) return null;
  if (ai && !ai.enabled && spec.stories.length === 0) return null;

  return (
    <section className="suggest" aria-label="Build from stories">
      <header>
        <div>
          <strong>Build from your stories</strong>
          <p className="hint">
            {unplaced > 0 ? `${unplaced} ${unplaced === 1 ? "story is" : "stories are"} not on a page yet. ` : ""}
            The model only picks from closed lists, you accept each pick, and the app is then generated without it.
            {ai?.enabled && ai.model ? ` Model: ${ai.model}.` : ""}
          </p>
        </div>
        {phase === "building" ? (
          <button onClick={() => { stop.current = true; }}>Stop</button>
        ) : (
          <div className="inline">
            <button disabled={!ai?.enabled || phase === "asking" || !spec.stories.length} onClick={() => void next()}>Suggest next</button>
            <button className="primary" disabled={!ai?.enabled || phase === "asking" || !spec.stories.length} onClick={() => void buildAll()}>Build it all</button>
          </div>
        )}
      </header>

      {ai && !ai.enabled && <p className="notice info">Suggestions are off: no model is configured. Put <code>NEBIUS_API_KEY</code> in <code>.env</code> (see <code>.env.example</code>) and restart the server.</p>}
      {phase === "asking" && <p className="muted">Working out the next step…</p>}
      {phase === "building" && <p className="muted">{applied} accepted so far{current ? `: ${current.title}` : ""}…</p>}
      {message && phase !== "building" && <p className={ai?.enabled === false || /fail|answered|not configured|No model/i.test(message) ? "error" : "muted"}>{message}</p>}

      {current && phase === "showing" && (
        <article className={`card suggestion${current.problem ? " problem" : ""}`}>
          <header className="card-head">
            <span className="chip small">{STEP_LABEL[current.step]}</span>
            <strong>{current.title}</strong>
            <span className="spacer" />
            <span className="muted small">{current.source === "ai" ? `model: ${current.model ?? "?"}` : "from your stories, no model"}</span>
          </header>
          {current.problem ? (
            <p className="error">The model could not give a usable answer: {current.problem}. Try again, or skip this and decide it yourself.</p>
          ) : (
            <ul className="plain-list">{current.lines.map((l, n) => <li key={n}>{l}</li>)}</ul>
          )}
          <div className="inline">
            {current.problem
              ? <button className="primary" onClick={() => void next()}>Try again</button>
              : <button className="primary" onClick={() => void accept(current)}>Accept</button>}
            <button onClick={() => void skip(current)}>Skip</button>
            {!current.problem && <button className="ghost" onClick={() => { setCurrent(null); setPhase("idle"); }}>Decide myself</button>}
          </div>
        </article>
      )}
    </section>
  );
}
