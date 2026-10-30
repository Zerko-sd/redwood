import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyCommand } from "@redwood/spec/src/commands";
import type { Command, Spec, Suggestion } from "../api";
import { canReorder, cellToCommands, columnsOf, createRow, ghostDiff, ghostKey, moveRow, removeRow, specToRows, tabsFor, type GhostDiff } from "./bind";
import { SheetError, GROUP_LABEL, type Draft, type Tab, type TabGroup } from "./defs";
import { Grid, type Edit, type Spot } from "./Grid";
import { flagsFor } from "./rules";

interface Undoable { tab: string; undo: Edit[]; redo: Edit[]; removeRows: string[] }

export interface SheetProps {
  spec: Spec;
  /** The newest spec, read at the moment an edit is built so quick edits never work from a stale copy. */
  latest: () => Spec;
  send: (commands: Command[]) => Promise<boolean>;
  tell: (text: string) => void;
  canEdit: boolean;
  tab: string;
  onTab: (id: string) => void;
  goTo: (Spot & { n: number }) | null;
  /** Show only rows for this role or table, where a sheet has that column. */
  filter: { role: string; entity: string };
  suggestion: Suggestion | null;
  onAcceptSuggestion: () => void;
  onSkipSuggestion: () => void;
  onDecideMyself: () => void;
}

const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

const run = (s: Spec, commands: Command[]) => commands.reduce<Spec>((acc, c) => applyCommand(acc, c), s);

/** A suggestion's commands applied to a copy, so it can be shown in place before anyone accepts it. */
export function previewOf(spec: Spec, suggestion: Suggestion | null): GhostDiff | null {
  if (!suggestion || suggestion.problem || !suggestion.commands.length) return null;
  try {
    return ghostDiff(spec, run(spec, suggestion.commands));
  } catch {
    return null; // a suggestion that no longer fits still shows in the panel; nothing to draw in cells
  }
}

export function Sheet({ spec, latest, send, tell, canEdit, tab, onTab, goTo, filter, suggestion, onAcceptSuggestion, onSkipSuggestion, onDecideMyself }: SheetProps) {
  const tabs = useMemo(() => tabsFor(spec), [spec]);
  const current: Tab = tabs.find((t) => t.id === tab) ?? tabs[1]!;
  const columns = useMemo(() => columnsOf(spec, current.id), [spec, current.id]);
  const allRows = useMemo(() => specToRows(spec, current.id), [spec, current.id]);
  const rows = useMemo(
    () => allRows.filter((r) => (!filter.role || !("role" in r.cells) || r.cells.role === filter.role) && (!filter.entity || !("entity" in r.cells) || r.cells.entity === filter.entity)),
    [allRows, filter],
  );
  const flags = useMemo(() => flagsFor(spec, current.id), [spec, current.id]);
  const ghosts = useMemo(() => previewOf(spec, suggestion), [spec, suggestion]);
  const undoStack = useRef<Undoable[]>([]);
  const redoStack = useRef<Undoable[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [spot, setSpot] = useState<(Spot & { n: number }) | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);

  // Writes run one at a time: each is built from the newest spec, so two quick edits can't undo each other.
  const enqueue = useCallback((job: () => Promise<boolean>) => {
    const next = queue.current.then(job, job);
    queue.current = next.catch(() => false);
    return next;
  }, []);

  const apply = useCallback((tabId: string, edits: Edit[], added: Draft[]): Promise<{ ok: boolean; created: string[] }> => {
    let created: string[] = [];
    const done = enqueue(async () => {
      let s = latest();
      const commands: Command[] = [];
      try {
        for (const e of edits) {
          const c = cellToCommands(s, tabId, e.rowId, e.col, e.value);
          s = run(s, c);
          commands.push(...c);
        }
        const before = new Set(specToRows(s, tabId).map((r) => r.id));
        for (const d of added) {
          const c = createRow(s, tabId, d);
          if (!c) continue;
          s = run(s, c);
          commands.push(...c);
        }
        created = specToRows(s, tabId).filter((r) => !before.has(r.id)).map((r) => r.id);
      } catch (e) {
        tell(e instanceof Error ? e.message.replace(/^[a-z]+\.\d+[^:]*: /, "") : String(e));
        return false;
      }
      return send(commands);
    });
    return done.then((ok) => ({ ok, created }));
  }, [enqueue, latest, send, tell]);

  const onEdit = useCallback(async (edits: Edit[], added: Draft[]) => {
    const before = new Map(specToRows(latest(), current.id).map((r) => [r.id, r]));
    const undo = edits.map((e) => ({ ...e, value: before.get(e.rowId)?.cells[e.col] ?? "" }));
    const r = await apply(current.id, edits, added);
    if (!r.ok) return;
    undoStack.current.push({ tab: current.id, undo, redo: edits, removeRows: r.created });
    redoStack.current = [];
  }, [apply, current.id, latest]);

  const onCreate = useCallback(async (draft: Draft): Promise<boolean> => {
    let commands: Command[] | null;
    try {
      commands = createRow(latest(), current.id, draft);
    } catch (e) {
      if (e instanceof SheetError) { tell(e.message); return false; }
      throw e;
    }
    if (!commands) return false;
    const r = await apply(current.id, [], [draft]);
    if (r.ok) undoStack.current.push({ tab: current.id, undo: [], redo: [], removeRows: r.created });
    return r.ok;
  }, [apply, current.id, latest, tell]);

  const onRemove = useCallback((ids: string[]) => {
    void enqueue(async () => {
      let s = latest();
      const commands: Command[] = [];
      try {
        for (const id of ids) {
          const c = removeRow(s, current.id, id);
          s = run(s, c);
          commands.push(...c);
        }
      } catch (e) {
        tell(e instanceof Error ? e.message.replace(/^[a-z]+\.\d+[^:]*: /, "") : String(e));
        return false;
      }
      return send(commands);
    });
  }, [enqueue, current.id, latest, send, tell]);

  const undo = useCallback(() => {
    const step = undoStack.current.pop();
    if (!step) return;
    onTab(step.tab);
    void apply(step.tab, step.undo, []);
    if (step.removeRows.length) {
      void enqueue(async () => {
        let s = latest();
        const commands = step.removeRows.flatMap((id) => { const c = removeRow(s, step.tab, id); s = run(s, c); return c; });
        return send(commands);
      });
    }
    redoStack.current.push(step);
  }, [apply, enqueue, latest, onTab, send]);

  const redo = useCallback(() => {
    const step = redoStack.current.pop();
    if (!step) return;
    onTab(step.tab);
    void apply(step.tab, step.redo, []);
    undoStack.current.push(step);
  }, [apply, onTab]);

  // A suggestion lands the grid on the first thing it would change.
  useEffect(() => {
    if (!ghosts?.first) return;
    onTab(ghosts.first.tab);
    setSpot({ rowId: ghosts.first.rowId, col: ghosts.first.col, n: Date.now() });
  }, [ghosts, onTab]);
  useEffect(() => { if (goTo) setSpot(goTo); }, [goTo]);

  const ghostOf = useCallback((rowId: string, col: string) => ghosts?.cells.get(ghostKey(current.id, rowId, col)), [ghosts, current.id]);
  const hasGhost = !!ghosts && !!suggestion;

  const groups = useMemo(() => {
    const map = new Map<TabGroup, Tab[]>();
    for (const t of tabs) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map];
  }, [tabs]);

  return (
    <div className="sheet-area">
      <Grid
        tab={current}
        columns={columns}
        rows={rows}
        ghostRows={ghosts?.rows.get(current.id) ?? []}
        ghostOf={ghostOf}
        flags={flags}
        canEdit={canEdit}
        goTo={spot}
        onEdit={onEdit}
        onCreate={onCreate}
        onRemove={onRemove}
        onMove={canEdit && canReorder(current) ? (id, before) => void send(moveRow(current, id, before)) : undefined}
        onUndo={undo}
        onRedo={redo}
        onAccept={hasGhost ? onAcceptSuggestion : undefined}
        onSkip={hasGhost ? onSkipSuggestion : undefined}
        onOverride={hasGhost ? onDecideMyself : undefined}
        onSelect={setSelected}
      />
      <div className="float-bar" role="toolbar" aria-label="Sheet actions">
        <span className="count">{rows.length === allRows.length ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}` : `${rows.length} of ${allRows.length}`}</span>
        {canEdit && !current.fixed && (
          <>
            <button title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo}><Glyph d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
            <button title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo}><Glyph d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></button>
            {current.rows && <button title="Remove this row" aria-label="Remove this row" disabled={!selected} onClick={() => { if (selected) onRemove([selected.rowId]); }}><Glyph d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></button>}
          </>
        )}
      </div>
      <nav className="sheet-tabs" aria-label="Sheets">
        {groups.map(([group, list]) => (
          <div key={group} className="sheet-tab-group">
            <span className="sheet-tab-label">{GROUP_LABEL[group]}</span>
            {list.map((t) => (
              <button key={t.id} className={t.id === current.id ? "on" : ""} onClick={() => onTab(t.id)}>{t.name}</button>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
