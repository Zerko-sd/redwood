import type { Command } from "@redwood/spec";

/** Types only, so the browser can import them without pulling in anything from node. */
export type StepName = "place" | "fields" | "operations" | "audience" | "access" | "rules" | "theme";

/** One open question and the commands that answer it. Nothing here is applied until a person accepts it. */
export interface Suggestion {
  /** Stable for the same question over the same inputs, so a dismissal is remembered and a changed story is asked again. */
  key: string;
  step: StepName;
  title: string;
  lines: string[];
  because: string[];
  commands: Command[];
  source: "ai" | "rule";
  model?: string;
  promptHash?: string;
  /** Set when the model could not give a usable answer. The person can try again or skip it; nothing is guessed. */
  problem?: string;
}
