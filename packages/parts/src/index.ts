/**
 * The abstract parts contract. The planner picks from this closed list; a kit
 * maps each part to its own library components. A kit that lacks a part must
 * declare it so the generator emits a placeholder instead of guessing.
 */
export const PARTS = [
  "Page", "Toolbar", "Table", "Board", "Form", "DetailPane", "StatCards",
  "Dialog", "EmptyState", "StateButtons", "SearchBox", "Button", "Notifications", "StoryList",
] as const;
export type PartName = (typeof PARTS)[number];

/**
 * The closed lists a person (or a model) picks from. Only names and descriptions live here; what each name
 * renders as lives in the generator, and a test fails if a name has no implementation. Adding a layout means
 * adding it here and registering its renderer, nothing else.
 */
export const LAYOUTS = {
  list: "Records in a table, with a side panel for the one you select. The default.",
  board: "Records as cards in one column per workflow state. Needs an entity with a workflow.",
  "form-page": "One form on the page, for a screen that only creates records.",
} as const;
export type LayoutId = keyof typeof LAYOUTS;
export const isLayout = (s: string): s is LayoutId => Object.hasOwn(LAYOUTS, s);

/** A block name a screen may ask for beyond the layout's own. Redwood ships none; companies add their own. */
export const BLOCK_ID = /^[a-z][a-z0-9-]*$/;

/** Slots of the bento grid every screen is laid out on. */
export const SLOTS = ["header", "toolbar", "main", "aside", "footer"] as const;
export type SlotName = (typeof SLOTS)[number];

/** Which parts are allowed in which slot. */
export const SLOT_PARTS: Record<SlotName, readonly PartName[]> = {
  header: ["Page"],
  toolbar: ["Toolbar", "SearchBox", "StateButtons"],
  main: ["Table", "Board", "EmptyState", "Form"],
  aside: ["Form", "DetailPane", "Dialog"],
  footer: ["StatCards"],
};

/** Theme tokens a kit must map onto its own CSS variables. */
export const THEME_TOKENS = [
  "background", "surface", "foreground", "foreground-muted", "primary", "primary-foreground",
  "muted", "border", "danger", "radius", "font-sans", "font-display",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export const DEFAULT_TOKENS: Record<ThemeToken, string> = {
  background: "#ffffff",
  surface: "#fbfbfa",
  foreground: "#37352f",
  "foreground-muted": "#6b6a67",
  primary: "#2383e2",
  "primary-foreground": "#ffffff",
  muted: "#efefed",
  border: "#e9e9e7",
  danger: "#d44c47",
  radius: "5px",
  "font-sans": '"IBM Plex Sans", system-ui, sans-serif',
  "font-display": '"IBM Plex Sans", system-ui, sans-serif',
};

/**
 * Named token sets. A spec's `theme.preset` picks one and `theme.tokens` overrides single values, so a company
 * look is a handful of tokens, never edits to components. Add a theme by adding an entry.
 */
export const THEMES: Record<string, { description: string; tokens: Partial<Record<ThemeToken, string>> }> = {
  default: { description: "White canvas, warm grey text, blue accent. Notion-like.", tokens: {} },
  harbor: {
    description: "Pale blue-grey ground, deep blue accent.",
    tokens: { background: "#f2f5f9", primary: "#1d4673", muted: "#e6ecf3", border: "#d5dde8", "foreground-muted": "#56637a" },
  },
  graphite: {
    description: "Neutral grey ground, near-black accent. Quiet and dense.",
    tokens: { background: "#f5f5f4", primary: "#20242c", muted: "#ebebe9", border: "#dcdcd8", radius: "2px" },
  },
};
export const isTheme = (s: string): boolean => Object.hasOwn(THEMES, s);

export interface UiKit {
  name: string;
  version: string;
  /** Parts this kit cannot render. The generator emits placeholders for them. */
  missing: readonly PartName[];
  /** npm packages the kit's files import (fonts, component libraries), merged into the app's package.json. */
  dependencies: Record<string, string>;
  /** Files placed under src/web/ui/, keyed by relative path. Must be pure. */
  files(tokens: Record<string, string>): Record<string, string>;
}
