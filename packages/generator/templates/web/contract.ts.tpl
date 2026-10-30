import type { ReactNode } from "react";

/**
 * The parts contract. Generated pages import these components from "../ui" and
 * nothing else, so any UI kit that implements these props can be swapped in.
 */
export type Row = Record<string, unknown>;

export interface Column {
  key: string;
  label: string;
  type: string;
  /** For reference columns: record id -> the name to show instead of the id. */
  lookup?: Record<string, string>;
}

export interface FormField extends Column {
  required: boolean;
  options?: string[];
  /** For reference fields: the records the signed-in role may pick from. */
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface PageProps {
  title: string;
  /** One line under the title, in the user's own words (the story this screen serves). */
  subtitle?: string;
  /** The screen's main action, shown opposite the title. */
  actions?: ReactNode;
  children?: ReactNode;
}

export interface ToolbarProps {
  children?: ReactNode;
}

export interface StoryListProps {
  items: { text: string; reason?: string; to?: { path: string; label: string } }[];
}

export interface ButtonProps {
  variant?: "primary" | "ghost" | "danger";
  size?: "small";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

export interface TableProps {
  columns: Column[];
  rows: Row[];
  /** Makes the first column open the record. */
  onOpen?: (row: Row) => void;
  rowActions?: (row: Row) => ReactNode;
}

export interface BoardProps {
  lanes: { id: string; title: string; rows: Row[] }[];
  titleOf: (row: Row) => string;
  /** A few short lines under a card's title. */
  detailsOf: (row: Row) => string[];
  onOpen?: (row: Row) => void;
  rowActions?: (row: Row) => ReactNode;
}

/** What a developer-written block (custom/blocks/*.tsx) receives. The page owns the data; the block only renders it. */
export interface BlockProps {
  title: string;
  rows: Row[];
  columns: Column[];
  role: string;
}

export interface FormProps {
  fields: FormField[];
  initial?: Row | null;
  error?: string;
  submitLabel?: string;
  onSubmit: (values: Row) => void;
  onCancel?: () => void;
}

export interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}

export interface TabsProps {
  tabs: { id: string; label: string; count?: number; content: ReactNode }[];
}

export interface RecordPageProps extends TabsProps {
  title: string;
  /** A few short values shown under the title. */
  summary: string[];
  back: { label: string; onClick: () => void };
  /** The address of the record's picture, if its table has one. */
  image?: string;
  actions?: ReactNode;
}

export interface RecordDetailsProps {
  fields: FormField[];
  values: Row;
  /** Column keys shown but never editable here. */
  locked: Set<string>;
  canEdit: boolean;
  /** Resolves to null when saved, or the message to show. */
  onSave: (changes: Row) => Promise<string | null>;
}

export interface RelatedListProps {
  columns: Column[];
  rows: Row[];
  onOpen?: (row: Row) => void;
  empty: string;
}

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export interface StateButtonsProps {
  next: string[];
  onMove: (to: string) => void;
}

export interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export interface StatCardsProps {
  items: { label: string; value: string | number }[];
}

export interface PlaceholderProps {
  /** In words: "the detail pane on Buses". */
  what: string;
  /** The developer file that resolves it, when there is one. */
  where?: string;
}

/** Shows a short message to the user. Provided by the kit, used by pages and the data layer. */
export type Notify = (message: string, tone?: "ok" | "error") => void;
