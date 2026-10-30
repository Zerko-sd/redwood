import type { Spec } from "../api";

/**
 * The sheet is a view of the spec, never a stored workbook. A cell holds plain text (names, not ids), which keeps
 * paste, undo and the suggestion diff simple: `bind.ts` turns that text back into spec commands.
 */
export type ColType = "text" | "longtext" | "number" | "bool" | "enum" | "tags";

export interface Col {
  key: string;
  header: string;
  type: ColType;
  width: number;
  /** Choices for enum and tags cells. The row is passed so a list can narrow to it. */
  options?: (row: Row | null) => string[];
  /** A value outside the options is allowed, and means "add this". */
  free?: boolean;
  required?: boolean;
  readOnly?: (row: Row) => boolean;
  /** Shown in an empty cell. */
  hint?: string;
}

export interface Row {
  /** Stable across edits: a spec id, never a position. */
  id: string;
  cells: Record<string, string>;
}

export type TabGroup = "work" | "lists" | "library" | "rows";

export interface Tab {
  id: string;
  name: string;
  group: TabGroup;
  /** True when a person can add and remove rows. */
  rows: boolean;
  /** True when no cell can be changed here. */
  fixed?: boolean;
  /** The spec list behind drag-reordering, when there is one. */
  order?: { list: "roles" | "stories" | "entities" | "screens" | "endpoints" | "services" | "fields" };
}

export const GROUP_LABEL: Record<TabGroup, string> = { work: "Work", lists: "Lists", library: "Library", rows: "Rows" };

export class SheetError extends Error {}

export type SpecT = Spec;
export type Draft = Record<string, string>;
