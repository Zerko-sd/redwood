import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatValue } from "../format";
import type {
  BoardProps, ButtonProps, Column, DetailPaneProps, DialogProps, EmptyStateProps, FormProps, Notify, PageProps,
  PlaceholderProps, Row, SearchBoxProps, StatCardsProps, StateButtonsProps, StoryListProps, TableProps, ToolbarProps,
} from "./contract";

const numeric = (c: Column) => c.type === "number" || c.type === "money";

export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <section className="rw-page">
      <header className="rw-head">
        <div>
          <h1 className="rw-title">{title}</h1>
          {subtitle && <p className="rw-lede">{subtitle}</p>}
        </div>
        {actions && <div className="rw-head-actions">{actions}</div>}
      </header>
      <div className="rw-body">{children}</div>
    </section>
  );
}

export function Toolbar({ children }: ToolbarProps) {
  return <div className="rw-toolbar">{children}</div>;
}

export function Button({ variant = "ghost", size, type = "button", disabled, onClick, children }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`rw-btn rw-btn-${variant}${size === "small" ? " rw-btn-small" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SearchBox({ value, onChange }: SearchBoxProps) {
  return (
    <input
      className="rw-search"
      type="search"
      placeholder="Search"
      aria-label="Search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Table({ columns, rows, onOpen, rowActions }: TableProps) {
  return (
    <div className="rw-table-wrap">
      <table className="rw-table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} className={numeric(c) ? "num" : undefined}>{c.label}</th>)}
            {rowActions && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((c, i) => {
                const text = formatValue(row[c.key], c);
                return (
                  <td key={c.key} className={numeric(c) ? "num" : undefined}>
                    {i === 0 && onOpen ? (
                      <button className="rw-link rw-strong" onClick={() => onOpen(row)}>{text || "—"}</button>
                    ) : text || <span className="rw-faint">—</span>}
                  </td>
                );
              })}
              {rowActions && <td className="rw-row-actions">{rowActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One column per workflow state. Cards are plain bordered rows, not decorated tiles. */
export function Board({ lanes, titleOf, detailsOf, onOpen, rowActions }: BoardProps) {
  return (
    <div className="rw-board">
      {lanes.map((lane) => (
        <section key={lane.id} className="rw-lane" aria-label={lane.title}>
          <h2 className="rw-lane-title">
            {lane.title} <span className="rw-faint">{lane.rows.length}</span>
          </h2>
          {lane.rows.length === 0 && <p className="rw-faint rw-lane-empty">Nothing here</p>}
          {lane.rows.map((row) => (
            <article key={String(row.id)} className="rw-card">
              {onOpen ? (
                <button className="rw-link rw-strong" onClick={() => onOpen(row)}>{titleOf(row) || "—"}</button>
              ) : (
                <strong>{titleOf(row) || "—"}</strong>
              )}
              {detailsOf(row).map((line) => <p key={line} className="rw-faint rw-card-line">{line}</p>)}
              {rowActions && <div className="rw-card-actions">{rowActions(row)}</div>}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export function Form({ fields, initial, error, submitLabel = "Save", onSubmit, onCancel }: FormProps) {
  const [values, setValues] = useState<Row>(initial ?? {});
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  const inputType = (t: string) =>
    t === "number" || t === "money" ? "number" : t === "date" ? "date" : t === "datetime" ? "datetime-local" : t === "email" ? "email" : "text";
  return (
    <form
      className="rw-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {fields.map((f, i) => (
        <label key={f.key} className="rw-field">
          <span className="rw-label">{f.label}{f.required ? <span className="rw-faint"> (required)</span> : null}</span>
          {f.choices ? (
            <select className="rw-input" autoFocus={i === 0} required={f.required} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">{f.choices.length ? "Choose one" : "Nothing to choose from"}</option>
              {f.choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.options ? (
            <select className="rw-input" autoFocus={i === 0} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">Choose one</option>
              {f.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : f.type === "boolean" ? (
            <input type="checkbox" className="rw-check" checked={!!values[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
          ) : (
            <input
              className="rw-input"
              autoFocus={i === 0}
              type={inputType(f.type)}
              min={f.min}
              max={f.max}
              required={f.required}
              value={String(values[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </label>
      ))}
      {error && <p role="alert" className="rw-error">{error}</p>}
      <div className="rw-form-actions">
        {onCancel && <button className="rw-btn rw-btn-ghost" type="button" onClick={onCancel}>Cancel</button>}
        <button className="rw-btn rw-btn-primary" type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

/** A modal on the browser's own <dialog>: focus is trapped, Esc closes it, and the page behind is inert. */
export function Dialog({ title, open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="rw-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="rw-dialog-body">
          <h2 className="rw-dialog-title">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function DetailPane({ title, fields, actions, onClose }: DetailPaneProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("rw-has-detail"); // lets the page leave room for the panel
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("rw-has-detail");
    };
  }, [onClose]);
  return (
    <aside className="rw-detail" aria-label={title}>
      <div className="rw-detail-head">
        <h2 className="rw-detail-title">{title}</h2>
        <button className="rw-link" onClick={onClose}>Close</button>
      </div>
      <dl className="rw-detail-list">
        {fields.map((f) => (
          <div key={f.label} className="rw-detail-row">
            <dt>{f.label}</dt>
            <dd>{f.value || <span className="rw-faint">—</span>}</dd>
          </div>
        ))}
      </dl>
      {actions && <div className="rw-detail-actions">{actions}</div>}
    </aside>
  );
}

export function StateButtons({ next, onMove }: StateButtonsProps) {
  return (
    <>
      {next.map((s) => (
        <button key={s} className="rw-btn rw-btn-ghost rw-btn-small" onClick={() => onMove(s)}>
          Mark {s}
        </button>
      ))}
    </>
  );
}

/** A role's stories as plain rows: what they want to do, why, and where to do it, or a visible gap. */
export function StoryList({ items }: StoryListProps) {
  if (!items.length) {
    return <p className="rw-lede">No stories have been written for this role yet.</p>;
  }
  return (
    <ul className="rw-stories">
      {items.map((s) => (
        <li key={s.text} className="rw-story">
          <div>
            <p className="rw-story-text">{s.text.charAt(0).toUpperCase() + s.text.slice(1)}</p>
            {s.reason && <p className="rw-lede">So that {s.reason}</p>}
          </div>
          {s.to ? (
            <Link className="rw-link rw-strong" to={s.to.path}>{s.to.label} →</Link>
          ) : (
            <span className="rw-story-gap">No screen serves this yet</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="rw-empty">
      <p className="rw-empty-title">{title}</p>
      {hint && <p className="rw-lede">{hint}</p>}
      {action}
    </div>
  );
}

/** A single plain line of totals, not a row of tiles. */
export function StatCards({ items }: StatCardsProps) {
  return <p className="rw-lede">{items.map((i) => `${i.value} ${i.label}`).join(" · ")}</p>;
}

/** Shown wherever the kit has no part and no template exists: a visible gap, never a guess. */
export function Placeholder({ what, where }: PlaceholderProps) {
  return (
    <div className="rw-placeholder" role="note">
      <strong>Developer needed.</strong> Redwood has no template for {what}.
      {where && <> Build it in <code>{where}</code>.</>}
    </div>
  );
}

// ---- notifications: a module-level queue, so any code can call notify() without a provider

interface Note {
  id: number;
  message: string;
  tone: "ok" | "error";
}
let notes: Note[] = [];
let seq = 0;
const listeners = new Set<(n: Note[]) => void>();
const publish = () => listeners.forEach((l) => l(notes));

export const notify: Notify = (message, tone = "ok") => {
  const id = ++seq;
  notes = [...notes, { id, message, tone }];
  publish();
  setTimeout(() => {
    notes = notes.filter((n) => n.id !== id);
    publish();
  }, tone === "error" ? 7000 : 3500);
};

export function Notifications() {
  const [list, setList] = useState<Note[]>(notes);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  return (
    <div className="rw-notes" role="status" aria-live="polite">
      {list.map((n) => <p key={n.id} className={`rw-note rw-note-${n.tone}`}>{n.message}</p>)}
    </div>
  );
}
