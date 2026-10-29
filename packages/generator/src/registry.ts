import type { Entity, Screen, Spec } from "@redwood/spec";
import type { LayoutId, PartName, UiKit } from "@redwood/parts";
import type { ScreenPlan } from "@redwood/planner";

/** Something Redwood could not do for itself, and the developer file that resolves it once edited. */
export interface Gap {
  what: string;
  why: string;
  /** A developer-owned file. Once it differs from the scaffold Redwood wrote, the gap is considered filled. */
  file?: string;
}

/**
 * Everything a block needs to render itself. A page is one scaffold that owns the data (rows, loading, query,
 * editing, selected, ...) and blocks only reference those names, so a block works in any layout and a layout
 * never needs to know what a block does.
 */
export interface PageCtx {
  spec: Spec;
  plan: ScreenPlan;
  screen: Screen;
  entity: Entity;
  kit: UiKit;
  gaps: Gap[];
  table: string;
  word: string;
  wfCol?: string;
  /** Parts used, so the page imports exactly what it renders. */
  used: Set<string>;
  /** Import lines for developer-written blocks. */
  extraImports: string[];
  /** Files Redwood creates once and never overwrites. */
  scaffold: Record<string, string>;
  has(part: PartName): boolean;
  ok(part: PartName): boolean;
  answer(id: string): boolean;
  /** The part's JSX, or a visible placeholder (and a recorded gap) if the kit has no such part. */
  part(part: PartName, jsx: () => string): string;
  flags: { canCreate: boolean; canEdit: boolean; canDelete: boolean; dialogOk: boolean; detail: boolean; states: boolean };
  customs: ScreenPlan["actions"];
  /** JSX for the per-row buttons (workflow moves, custom actions). */
  rowButtons: string[];
  rowActionsProp: string;
  newButton(label: string): string;
}

export type SlotId = "actions" | "toolbar" | "main" | "overlays" | "footer";

export interface BlockDef {
  id: string;
  description: string;
  /** JSX (or, for the actions slot, one expression) already indented as it will appear, or "" for nothing. */
  render(ctx: PageCtx): string;
}

export interface LayoutDef {
  id: LayoutId;
  description: string;
  /** Which blocks fill each slot, in order. A layout composes; it never renders content itself. */
  blocks: Record<SlotId, string[]>;
  /** The page element around the slot contents. */
  shell(title: string, parts: Record<SlotId, string>): string;
}

const core = new Map<string, BlockDef>();
const layouts = new Map<LayoutId, LayoutDef>();
const named = new Map<string, BlockDef>();

function register<T extends { id: string }>(map: Map<string, T>, def: T, kind: string): void {
  if (map.has(def.id)) throw new Error(`${kind} "${def.id}" is already registered`);
  map.set(def.id, def);
}

/** A building block layouts compose. */
export const registerBlock = (def: BlockDef) => register(core, def, "block");
export const getBlock = (id: string) => core.get(id);

/** A page shape. Selected by name from the spec's `layout`. */
export const registerLayout = (def: LayoutDef) => register(layouts as Map<string, LayoutDef>, def, "layout");
export const getLayout = (id: string) => layouts.get(id as LayoutId);
export const registeredLayouts = () => [...layouts.keys()];

/**
 * A block a spec may name in `screen.blocks` (a company's `live-map`). One that is not registered here is not an
 * error: the generator writes a developer file and shows a visible placeholder, never a guess.
 */
export const registerNamedBlock = (def: BlockDef) => register(named, def, "named block");
export const getNamedBlock = (id: string) => named.get(id);
