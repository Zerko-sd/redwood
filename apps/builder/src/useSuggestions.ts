import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Builds the spec from the stories, one open question at a time. Nothing is applied until it is accepted, and
 * "Build it all" is the same acceptance in a loop: every pick is still its own revision with its source recorded.
 * Lives above both the rail and the sheet, because the rail asks the question and the sheet shows it in place.
 */
export function useSuggestions(id: string, me: string, send: (c: Command[]) => Promise<boolean>) {
  const [ai, setAi] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState(0);
  const stop = useRef(false);

  useEffect(() => void api.ai().then(setAi).catch(() => setAi({ enabled: false, model: null })), []);

  /** Asks for the next question. Returns it, or null when there is nothing left or it could not be asked. */
  const ask = useCallback(async (): Promise<Suggestion | null> => {
    try {
      const r = await api.suggestion(id);
      return r.suggestion;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : String(e));
      return null;
    }
  }, [id]);

  const next = useCallback(async () => {
    setMessage("");
    setPhase("asking");
    const s = await ask();
    setCurrent(s);
    setPhase(s ? "showing" : "idle");
    if (!s) setMessage((m) => m || "Nothing left to suggest.");
  }, [ask]);

  const accept = useCallback(async (s: Suggestion) => {
    if (!(await send(stamp(s.commands, me)))) return;
    setApplied((n) => n + 1);
    await next();
  }, [send, me, next]);

  const skip = useCallback(async (s: Suggestion) => {
    await api.skipSuggestion(id, s.key).catch(() => {});
    await next();
  }, [id, next]);

  const dismiss = useCallback(() => { setCurrent(null); setPhase("idle"); }, []);

  const buildAll = useCallback(async () => {
    stop.current = false;
    setMessage("");
    setApplied(0);
    for (let i = 0; i < 80 && !stop.current; i++) {
      setPhase("building");
      const s = await ask();
      setCurrent(s);
      if (!s) { setPhase("idle"); setMessage((m) => m || "Done. Look through the sheets, then run the preview."); return; }
      // A question the model could not answer is left for a person; the loop never guesses past it.
      if (s.problem || !(await send(stamp(s.commands, me)))) { setPhase("showing"); return; }
      setApplied((n) => n + 1);
    }
    setPhase("idle");
    setMessage(stop.current ? "Stopped." : "Stopped after 80 steps.");
  }, [ask, send, me]);

  return { ai, phase, current, message, applied, next, accept, skip, dismiss, buildAll, halt: () => { stop.current = true; } };
}
export type SuggestionsState = ReturnType<typeof useSuggestions>;
export type { Spec };
