import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Col, Draft, Row, Tab } from "./defs";
import { flagKey, type Flag } from "./rules";

export interface Edit { rowId: string; col: string; value: string }
export interface Spot { rowId: string; col: string }

interface Props {
  tab: Tab;
  columns: Col[];
  rows: Row[];
  /** Rows a suggestion would add, shown after the real ones. */
  ghostRows: Row[];
  /** col+row -> suggested text. Enter accepts; Esc skips; typing over it decides by hand. */
  ghostOf: (rowId: string, col: string) => string | undefined;
  flags: Map<string, Flag>;
  canEdit: boolean;
  goTo: Spot | null;
  /** Reports an edit. `added` are whole new rows, from pasting or typing past the end. */
  onEdit: (edits: Edit[], added: Draft[]) => void;
  /** Tries to turn the row being typed into a real one. False leaves it as a draft, waiting for more. */
  onCreate: (draft: Draft) => Promise<boolean>;
  onRemove: (rowIds: string[]) => void;
  onMove?: (rowId: string, before: string | undefined) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAccept?: () => void;
  onSkip?: () => void;
  /** The person typed over a suggestion. */
  onOverride?: () => void;
  onSelect?: (spot: Spot | null) => void;
}

interface Range { r: number; c: number; r2: number; c2: number }
const DRAFT = "\0draft";

const box = (s: Range) => ({ top: Math.min(s.r, s.r2), bottom: Math.max(s.r, s.r2), left: Math.min(s.c, s.c2), right: Math.max(s.c, s.c2) });

/** Tab-separated text with Excel's quoting, so a cell holding a newline survives a copy. */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  const t = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") { rows.at(-1)!.push(cell); cell = ""; }
    else if (ch === "\n") { rows.at(-1)!.push(cell); cell = ""; rows.push([]); }
    else cell += ch;
  }
  rows.at(-1)!.push(cell);
  return rows;
}
export const toClipboard = (rows: string[][]) =>
  rows.map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t")).join("\n");

function widthsKey(tab: string) { return `redwood.widths.${tab}`; }
function loadWidths(tab: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(widthsKey(tab)) ?? "{}") as Record<string, number>; } catch { return {}; }
}
function saveWidths(tab: string, w: Record<string, number>) {
  try { localStorage.setItem(widthsKey(tab), JSON.stringify(w)); } catch { /* a remembered width is a convenience */ }
}

export function Grid(props: Props) {
  const { tab, columns, rows, ghostRows, ghostOf, flags, canEdit, goTo, onEdit, onCreate, onRemove, onMove, onUndo, onRedo, onAccept, onSkip, onOverride, onSelect } = props;
  const [sel, setSel] = useState<Range>({ r: 0, c: 0, r2: 0, c2: 0 });
  const [editing, setEditing] = useState<{ value: string } | null>(null);
  const [menu, setMenu] = useState<{ filter: string } | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(tab.id));
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dragSel = useRef(false);
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  // A new row is being saved. Anything typed meanwhile belongs to that row, not to another new one.
  const creating = useRef<Promise<boolean> | null>(null);

  const showDraft = canEdit && tab.rows && !tab.fixed;
  const draftRow: Row = useMemo(() => ({ id: DRAFT, cells: draft }), [draft]);
  const all = useMemo(() => [...rows, ...ghostRows, ...(showDraft ? [draftRow] : [])], [rows, ghostRows, showDraft, draftRow]);
  const realCount = rows.length;

  useEffect(() => { setSel({ r: 0, c: 0, r2: 0, c2: 0 }); setEditing(null); setMenu(null); setDraft({}); setWidths(loadWidths(tab.id)); }, [tab.id]);

  const clamp = useCallback((r: number, c: number) => ({ r: Math.max(0, Math.min(all.length - 1, r)), c: Math.max(0, Math.min(columns.length - 1, c)) }), [all.length, columns.length]);
  const focus = () => root.current?.focus({ preventScroll: true });
  const moveTo = useCallback((r: number, c: number, extend = false) => {
    const p = clamp(r, c);
    setSel((s) => (extend ? { ...s, r2: p.r, c2: p.c } : { r: p.r, c: p.c, r2: p.r, c2: p.c }));
  }, [clamp]);

  // A jump from the map, the rail or a suggestion: land on that cell.
  useEffect(() => {
    if (!goTo) return;
    const r = all.findIndex((x) => x.id === goTo.rowId);
    const c = columns.findIndex((x) => x.key === goTo.col);
    if (r >= 0) { moveTo(r, Math.max(0, c)); focus(); }
  }, [goTo, all, columns, moveTo]);

  useLayoutEffect(() => {
    root.current?.querySelector<HTMLElement>("td.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel.r2, sel.c2]);

  const row = all[sel.r] ?? null;
  const col = columns[sel.c] ?? null;
  useEffect(() => {
    onSelect?.(row && col && row.id !== DRAFT ? { rowId: row.id, col: col.key } : null);
  }, [row?.id, col?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const isGhostRow = (r: Row) => ghostRows.includes(r);
  const locked = (r: Row, c: Col) => !canEdit || !!tab.fixed || isGhostRow(r) || (r.id !== DRAFT && !!c.readOnly?.(r)) || (r.id === DRAFT && !!c.readOnly && c.readOnly({ id: DRAFT, cells: draft }));

  /** Writes one value to the row at an index: a real cell is an edit, the draft row is held until it can be created. */
  const commit = async (r: number, c: number, value: string) => {
    const target = all[r];
    const column = columns[c];
    if (!target || !column) return;
    if (target.id === DRAFT) {
      if (creating.current && await creating.current) {
        const made = rowsNow.current.at(-1);
        if (made) onEdit([{ rowId: made.id, col: column.key, value }], []);
        return;
      }
      const next = { ...draft, [column.key]: value };
      setDraft(next);
      creating.current = onCreate(next);
      const made = await creating.current;
      creating.current = null;
      if (made) setDraft({});
      return;
    }
    if ((target.cells[column.key] ?? "") === value) return;
    onEdit([{ rowId: target.id, col: column.key, value }], []);
  };

  const startEdit = (initial?: string) => {
    if (!row || !col || locked(row, col)) return;
    if (col.type === "bool") return void commit(sel.r, sel.c, row.cells[col.key] ? "" : "Yes");
    if (col.type === "enum" || col.type === "tags") return setMenu({ filter: initial ?? "" });
    setEditing({ value: initial ?? row.cells[col.key] ?? "" });
  };
  const finishEdit = (save: boolean, then?: [number, number]) => {
    if (editing && save) void commit(sel.r, sel.c, editing.value);
    setEditing(null);
    if (then) moveTo(sel.r + then[0], sel.c + then[1]);
    focus();
  };

  const clearRange = () => {
    if (!canEdit || tab.fixed) return;
    const b = box(sel);
    const edits: Edit[] = [];
    for (let r = b.top; r <= b.bottom; r++) {
      for (let c = b.left; c <= b.right; c++) {
        const target = all[r];
        const column = columns[c];
        if (!target || !column || target.id === DRAFT || locked(target, column) || !target.cells[column.key] || column.required) continue;
        edits.push({ rowId: target.id, col: column.key, value: "" });
      }
    }
    if (edits.length) onEdit(edits, []);
  };

  const onKey = (e: KeyboardEvent) => {
    if (editing || menu) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (ctrl && key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? onRedo() : onUndo(); }
    if (ctrl && key.toLowerCase() === "y") { e.preventDefault(); return onRedo(); }
    if (ctrl && key.toLowerCase() === "a") {
      e.preventDefault();
      return setSel({ r: 0, c: 0, r2: Math.max(0, realCount - 1), c2: columns.length - 1 });
    }
    if (ctrl) return;
    const extend = e.shiftKey;
    const at = extend ? { r: sel.r2, c: sel.c2 } : sel;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = arrows[key];
    if (step) { e.preventDefault(); return moveTo(at.r + step[0], at.c + step[1], extend); }
    switch (key) {
      case "Tab": e.preventDefault(); return moveTo(sel.r, sel.c + (extend ? -1 : 1));
      case "Enter":
        e.preventDefault();
        if (onAccept) return onAccept();
        if (extend) return moveTo(sel.r - 1, sel.c);
        return startEdit();
      case "F2": e.preventDefault(); return startEdit();
      case " ":
        e.preventDefault();
        return col?.type === "enum" || col?.type === "tags" || col?.type === "bool" ? startEdit() : startEdit(" ");
      case "Escape": if (onSkip) { e.preventDefault(); onSkip(); } return;
      case "Delete": case "Backspace": e.preventDefault(); return clearRange();
      case "Home": e.preventDefault(); return moveTo(sel.r, 0, extend);
      case "End": e.preventDefault(); return moveTo(sel.r, columns.length - 1, extend);
      case "PageDown": e.preventDefault(); return moveTo(at.r + 12, at.c, extend);
      case "PageUp": e.preventDefault(); return moveTo(at.r - 12, at.c, extend);
    }
    if (key.length === 1 && !e.altKey) {
      e.preventDefault();
      if (onOverride) onOverride();
      startEdit(key);
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    if (editing) return;
    const b = box(sel);
    const lines: string[][] = [];
    for (let r = b.top; r <= b.bottom; r++) {
      const line: string[] = [];
      for (let c = b.left; c <= b.right; c++) line.push(all[r]?.cells[columns[c]?.key ?? ""] ?? "");
      lines.push(line);
    }
    e.clipboardData.setData("text/plain", toClipboard(lines));
    e.preventDefault();
  };

  const onPaste = (e: ClipboardEvent) => {
    if (editing || !canEdit || tab.fixed) return;
    e.preventDefault();
    const lines = parseClipboard(e.clipboardData.getData("text/plain"));
    const b = box(sel);
    // One copied value fills a whole selected range, as it does in a spreadsheet.
    const fill = lines.length === 1 && lines[0]!.length === 1 && (b.bottom > b.top || b.right > b.left);
    const height = fill ? b.bottom - b.top + 1 : lines.length;
    const edits: Edit[] = [];
    const added: Draft[] = [];
    for (let i = 0; i < height; i++) {
      const source = fill ? lines[0]! : lines[i]!;
      const r = b.top + i;
      const target = r < realCount ? all[r] : null;
      const fresh: Draft = {};
      const wide = fill ? b.right - b.left + 1 : source.length;
      for (let j = 0; j < wide; j++) {
        const column = columns[b.left + j];
        if (!column) continue;
        const value = fill ? source[0]! : source[j]!;
        if (target) {
          if (!locked(target, column) && (target.cells[column.key] ?? "") !== value) edits.push({ rowId: target.id, col: column.key, value });
        } else if (value) fresh[column.key] = value;
      }
      if (Object.keys(fresh).length) added.push(fresh);
    }
    if (added.length && !tab.rows) added.length = 0;
    if (edits.length || added.length) onEdit(edits, added);
  };

  const b = box(sel);
  const resize = (key: string, start: number, width: number) => {
    const move = (e: PointerEvent) => setWidths((w) => ({ ...w, [key]: Math.max(56, width + e.clientX - start) }));
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setWidths((w) => { saveWidths(tab.id, w); return w; });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const widthOf = (c: Col) => widths[c.key] ?? c.width;
  const total = 44 + columns.reduce((n, c) => n + widthOf(c), 0);
  // The last column takes whatever room is left, so short sheets still reach the edge.
  const spare = root.current?.clientWidth ?? Infinity;

  return (
    <div
      ref={root}
      className="sheet"
      role="grid"
      aria-label={tab.name}
      aria-rowcount={all.length}
      tabIndex={0}
      onKeyDown={onKey}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <table style={{ width: `max(100%, ${total}px)` }}>
        <colgroup>
          <col style={{ width: 44 }} />
          {columns.map((c, i) => <col key={c.key} style={i === columns.length - 1 && total < spare ? undefined : { width: widthOf(c) }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="gutter" aria-hidden />
            {columns.map((c, i) => (
              <th key={c.key} className={i >= b.left && i <= b.right ? "on" : undefined} scope="col">
                {c.header}{c.required && <span className="req" title="Required">*</span>}
                <span
                  className="resize"
                  aria-hidden
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); resize(c.key, e.clientX, widthOf(c)); }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((r, ri) => {
            const isDraft = r.id === DRAFT;
            const ghostRow = isGhostRow(r);
            return (
              <tr
                key={r.id}
                className={`${isDraft ? "draft" : ""}${ghostRow ? " ghost-row" : ""}${dragging === r.id ? " dragging" : ""}`}
                onDragOver={onMove && dragging ? (e) => e.preventDefault() : undefined}
                onDrop={onMove && dragging ? (e) => {
                  e.preventDefault();
                  if (dragging !== r.id) onMove(dragging, isDraft ? undefined : r.id);
                  setDragging(null);
                } : undefined}
              >
                <th
                  className={`gutter${ri >= b.top && ri <= b.bottom ? " on" : ""}`}
                  scope="row"
                  draggable={!!onMove && !isDraft && !ghostRow && canEdit}
                  onDragStart={() => setDragging(r.id)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => { setSel({ r: ri, c: 0, r2: ri, c2: columns.length - 1 }); focus(); }}
                  onContextMenu={(e) => {
                    if (isDraft || ghostRow || !canEdit || !tab.rows) return;
                    e.preventDefault();
                    setRowMenu({ x: e.clientX, y: e.clientY, rowId: r.id });
                  }}
                >
                  {isDraft ? "+" : ri + 1}
                </th>
                {columns.map((c, ci) => {
                  const inRange = ri >= b.top && ri <= b.bottom && ci >= b.left && ci <= b.right;
                  const active = ri === sel.r && ci === sel.c;
                  const flag = flags.get(flagKey(r.id, c.key));
                  const ghost = ghostOf(r.id, c.key);
                  const text = ghost ?? r.cells[c.key] ?? "";
                  const lockedCell = locked(r, c);
                  const cls = [
                    active ? "active" : "", inRange ? "in-range" : "", lockedCell ? "locked" : "", c.type,
                    flag ? `flag-${flag.level}` : "", ghost !== undefined || ghostRow ? "ghost" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <td
                      key={c.key}
                      className={cls}
                      role="gridcell"
                      title={flag?.why ?? (ghost !== undefined ? "Suggested. Enter accepts, Esc skips, or type your own." : undefined)}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (editing) finishEdit(true);
                        moveTo(ri, ci, e.shiftKey);
                        dragSel.current = true;
                        focus();
                        const up = () => { dragSel.current = false; removeEventListener("pointerup", up); };
                        addEventListener("pointerup", up);
                      }}
                      onPointerEnter={() => { if (dragSel.current) moveTo(ri, ci, true); }}
                      onDoubleClick={() => startEdit()}
                    >
                      {active && editing ? (
                        <CellEditor
                          long={c.type === "longtext"}
                          value={editing.value}
                          onChange={(value) => setEditing({ value })}
                          onDone={finishEdit}
                        />
                      ) : (
                        <Display col={c} text={text} row={r} active={active} />
                      )}
                      {active && menu && !lockedCell && (
                        <Menu
                          col={c}
                          row={r}
                          value={r.cells[c.key] ?? ""}
                          filter={menu.filter}
                          onPick={(value, then) => {
                            void commit(ri, ci, value);
                            setMenu(null);
                            if (then) moveTo(ri + then[0], ci + then[1]);
                            focus();
                          }}
                          onCancel={() => { setMenu(null); focus(); }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rowMenu && (
        <RowMenu
          at={rowMenu}
          onClose={() => { setRowMenu(null); focus(); }}
          onRemove={() => {
            const b2 = box(sel);
            const inside = all.slice(b2.top, b2.bottom + 1).some((x) => x.id === rowMenu.rowId);
            const ids = inside ? all.slice(b2.top, b2.bottom + 1).map((x) => x.id).filter((id) => id !== DRAFT && rows.some((x) => x.id === id)) : [rowMenu.rowId];
            onRemove(ids);
            setRowMenu(null);
            focus();
          }}
        />
      )}
    </div>
  );
}

function Display({ col, text, row, active }: { col: Col; text: string; row: Row; active: boolean }) {
  if (col.type === "bool") return text ? <span className="tick" aria-label="Yes">✓</span> : null;
  if (col.type === "tags" && text) {
    return <span className="tags">{text.split(", ").map((t) => <span key={t} className="tag">{t}</span>)}</span>;
  }
  if (!text) return col.hint && (active || row.id === DRAFT) ? <span className="hint-text">{col.hint}</span> : null;
  return <span className="value">{text}</span>;
}

function CellEditor({ value, long, onChange, onDone }: { value: string; long: boolean; onChange: (v: string) => void; onDone: (save: boolean, then?: [number, number]) => void }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Removing the input fires blur, which must not commit what Enter or Tab just committed.
  const closed = useRef(false);
  const close = (save: boolean, then?: [number, number]) => {
    if (closed.current) return;
    closed.current = true;
    onDone(save, then);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && !(long && e.shiftKey)) { e.preventDefault(); close(true, [1, 0]); }
    if (e.key === "Tab") { e.preventDefault(); close(true, [0, e.shiftKey ? -1 : 1]); }
    if (e.key === "Escape") { e.preventDefault(); close(false); }
  };
  const common = {
    ref,
    value,
    className: "cell-input",
    "aria-label": "Cell",
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onKeyDown: onKey,
    onBlur: () => close(true),
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };
  return long ? <textarea {...common} rows={3} /> : <input {...common} />;
}

/** The dropdown for enum and tags cells. It sits over everything, so it can't be clipped by the scrolling sheet. */
function Menu({ col, row, value, filter, onPick, onCancel }: {
  col: Col; row: Row; value: string; filter: string;
  onPick: (value: string, then?: [number, number]) => void;
  onCancel: () => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [text, setText] = useState(filter);
  const [index, setIndex] = useState(0);
  const multi = col.type === "tags";
  const [picked, setPicked] = useState<string[]>(() => (multi && value ? value.split(", ") : []));
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const cell = anchor.current?.closest("td")?.getBoundingClientRect();
    if (!cell) return;
    const room = innerHeight - cell.bottom;
    setPos({ left: Math.min(cell.left, innerWidth - 260), top: room < 260 ? Math.max(8, cell.top - 268) : cell.bottom + 2, width: Math.max(cell.width, 200) });
  }, []);
  useEffect(() => input.current?.focus(), [pos]);

  const all = (col.options?.(row) ?? []).map(String);
  const shown = all.filter((o) => o.toLowerCase().includes(text.trim().toLowerCase()));
  const canAdd = !!col.free && !!text.trim() && !all.some((o) => o.toLowerCase() === text.trim().toLowerCase());
  const entries = canAdd ? [...shown, text.trim()] : shown;

  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const save = (then?: [number, number]) => onPick(picked.join(", "), then);
  const choose = (o: string, then?: [number, number]) => {
    if (multi) { toggle(o); setText(""); if (then) save(then); return; }
    onPick(o, then);
  };

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(entries.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const hit = entries[index];
      if (multi) { if (hit !== undefined && (text.trim() || !e.ctrlKey)) { if (text.trim() || hit !== undefined) choose(hit); } else save([1, 0]); }
      else if (hit !== undefined) choose(hit, [1, 0]);
    }
    else if (e.key === "Tab") {
      e.preventDefault();
      if (multi) save([0, e.shiftKey ? -1 : 1]);
      else if (entries[index] !== undefined) choose(entries[index]!, [0, e.shiftKey ? -1 : 1]);
      else onCancel();
    }
    else if (e.key === "Escape") { e.preventDefault(); if (multi) save(); else onCancel(); }
    else if (e.key === "Backspace" && multi && !text && picked.length) { e.preventDefault(); setPicked(picked.slice(0, -1)); }
  };

  return (
    <>
      <span ref={anchor} />
      {pos && createPortal(
        <>
          <div className="menu-scrim" onPointerDown={() => (multi ? save() : onCancel())} />
          <div className="cell-menu" role="listbox" style={{ left: pos.left, top: pos.top, width: pos.width }}>
            <input
              ref={input}
              className="cell-menu-filter"
              aria-label={`Choose ${col.header}`}
              placeholder={col.free ? "Search or add" : "Search"}
              value={text}
              onChange={(e) => { setText(e.target.value); setIndex(0); }}
              onKeyDown={onKey}
            />
            <ul>
              {entries.length === 0 && <li className="none">Nothing matches</li>}
              {entries.map((o, i) => {
                const on = multi ? picked.includes(o) : o === value;
                const isNew = canAdd && i === entries.length - 1;
                return (
                  <li
                    key={o || "\0blank"}
                    role="option"
                    aria-selected={on}
                    className={`${i === index ? "at" : ""}${on ? " on" : ""}`}
                    onPointerEnter={() => setIndex(i)}
                    onPointerDown={(e) => { e.preventDefault(); choose(o); }}
                  >
                    <span className="mark">{on ? "✓" : ""}</span>
                    {isNew ? <>Add “{o}”</> : o || <span className="muted">None</span>}
                  </li>
                );
              })}
            </ul>
            {multi && <footer>Enter picks · Tab saves</footer>}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function RowMenu({ at, onRemove, onClose }: { at: { x: number; y: number }; onRemove: () => void; onClose: () => void }) {
  return createPortal(
    <>
      <div className="menu-scrim" onPointerDown={onClose} />
      <div className="cell-menu row-menu" style={{ left: at.x, top: at.y }}>
        <ul><li className="danger" onPointerDown={(e) => { e.preventDefault(); onRemove(); }}>Remove row</li></ul>
      </div>
    </>,
    document.body,
  );
}
