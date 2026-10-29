import type { Spec } from "@redwood/spec";
import type { LlmClient } from "./llm";
import * as steps from "./steps";
import type { Context } from "./steps";
import type { Suggestion } from "./types";
export { NO_MODEL } from "./steps";

export * from "./llm";
export type { Context } from "./steps";
export type { StepName, Suggestion } from "./types";

/**
 * The next open question for this spec, or null when there is nothing left to ask.
 *
 * One question at a time, in the order a person would answer them: where each story lives, what each table
 * stores, what each page can do, who opens it, who can do what, then the finer rules and the look. Each step
 * looks at the spec as it stands, so accepting a suggestion is what lets the next one appear, and a suggestion
 * nobody has accepted never influences a later one.
 *
 * Throws LlmUnavailable when the next question needs a model and none is configured or reachable.
 */
export async function nextSuggestion(
  spec: Spec,
  opts: { llm: LlmClient | null; decided?: ReadonlySet<string>; decide?: (key: string) => void },
): Promise<Suggestion | null> {
  const decided = new Set(opts.decided ?? []);
  const ctx: Context = {
    llm: opts.llm,
    decided,
    // A question that needs no change is settled for good, and settled for the rest of this call too.
    decide: (key) => { decided.add(key); opts.decide?.(key); },
  };
  // Each pass either returns a question or settles one that needed no change, so this ends; the cap is a backstop.
  for (let pass = 0; pass < 100; pass++) {
    const before = decided.size;
    const found =
      (await steps.place(spec, ctx)) ??
      (await steps.fields(spec, ctx)) ??
      (await steps.operations(spec, ctx)) ??
      steps.audience(spec, ctx) ??
      steps.access(spec, ctx) ??
      (await steps.rules(spec, ctx)) ??
      (await steps.theme(spec, ctx));
    if (found) return found;
    if (decided.size === before) return null;
  }
  return null;
}
