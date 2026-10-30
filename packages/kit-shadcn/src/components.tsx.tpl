import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatValue } from "../format";
import type {
  BoardProps, ButtonProps, Column, DialogProps, EmptyStateProps, FormField, FormProps, Notify, PageProps,
  PlaceholderProps, RecordDetailsProps, RecordPageProps, RelatedListProps, Row, SearchBoxProps, StatCardsProps,
  StateButtonsProps, StoryListProps, TableProps, TabsProps, ToolbarProps,
} from "./contract";

const numeric = (c: Column) => ["number", "money", "percent", "rating"].includes(c.type);

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

const INPUT_TYPES: Record<string, string> = {
  number: "number", money: "number", percent: "number", rating: "number",
  date: "date", datetime: "datetime-local", email: "email", url: "url", color: "color", phone: "tel",
};

/** The right input for a field. The dropdowns, checkbox and text boxes of every form come from here. */
function FieldControl({ field: f, value, focus, disabled, onChange }: { field: FormField; value: unknown; focus?: boolean; disabled?: boolean; onChange: (v: unknown) => void }) {
  if (f.choices) {
    return (
      <select className="rw-input" autoFocus={focus} disabled={disabled} required={f.required} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.choices.length ? "Choose one" : "Nothing to choose from"}</option>
        {f.choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.options) {
    return (
      <select className="rw-input" autoFocus={focus} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose one</option>
        {f.options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === "boolean") return <input type="checkbox" className="rw-check" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <input
      className="rw-input"
      autoFocus={focus}
      disabled={disabled}
      type={INPUT_TYPES[f.type] ?? "text"}
      min={f.min}
      max={f.max}
      required={f.required}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Form({ fields, initial, error, submitLabel = "Save", onSubmit, onCancel }: FormProps) {
  const [values, setValues] = useState<Row>(initial ?? {});
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
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
          <FieldControl field={f} value={values[f.key]} focus={i === 0} onChange={(v) => set(f.key, v)} />
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

export function Tabs({ tabs }: TabsProps) {
  const [open, setOpen] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === open) ?? tabs[0];
  return (
    <>
      <div className="rw-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current?.id} className="rw-tab" onClick={() => setOpen(t.id)}>
            {t.label}{t.count !== undefined && <span className="rw-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </>
  );
}

/** One record: where it came from, what it is called, and a tab for each way of looking at it. */
export function RecordPage({ title, summary, back, image, actions, tabs }: RecordPageProps) {
  return (
    <section className="rw-page">
      <button className="rw-link rw-back" onClick={back.onClick}>← {back.label}</button>
      <header className="rw-record-head">
        {image && <img className="rw-thumb" src={image} alt="" />}
        <div className="rw-record-text">
          <h1 className="rw-record-title">{title}</h1>
          {summary.length > 0 && <p className="rw-summary">{summary.map((s) => <span key={s}>{s}</span>)}</p>}
        </div>
        {actions && <div className="rw-head-actions">{actions}</div>}
      </header>
      <Tabs tabs={tabs} />
    </section>
  );
}

/** Label on the left, control on the right. Saving sends only what changed. */
export function RecordDetails({ fields, values, locked, canEdit, onSave }: RecordDetailsProps) {
  const [draft, setDraft] = useState<Row>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0;
  const set = (key: string, value: unknown) =>
    setDraft((d) => {
      const next = { ...d };
      if (String(value ?? "") === String(values[key] ?? "")) delete next[key];
      else next[key] = value;
      return next;
    });
  const save = async () => {
    setSaving(true);
    const err = await onSave(draft);
    setSaving(false);
    setError(err ?? "");
    if (!err) setDraft({});
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2 className="rw-section-title">Details</h2>
      <div className="rw-rows">
        {fields.map((f) => {
          const open = canEdit && !locked.has(f.key);
          return (
            <label key={f.key} className="rw-row-field">
              <span className="rw-label">
                {f.label}
                {!open && canEdit && <span className="rw-row-note">You can't change this.</span>}
              </span>
              {open ? (
                <span className="rw-control"><FieldControl field={f} value={f.key in draft ? draft[f.key] : values[f.key]} onChange={(v) => set(f.key, v)} /></span>
              ) : (
                <span className="rw-row-value">{formatValue(values[f.key], f) || <span className="rw-faint">—</span>}</span>
              )}
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="rw-error">{error}</p>}
      {dirty && (
        <div className="rw-save">
          <button type="button" className="rw-btn" onClick={() => { setDraft({}); setError(""); }}>Discard</button>
          <button type="submit" className="rw-btn rw-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </form>
  );
}

/** A record's files and pictures: what is there now, and its address when this role may change it. */
export function RecordFiles({ fields, values, locked, canEdit, onSave }: RecordDetailsProps) {
  return (
    <div className="rw-rows">
      {fields.map((f) => {
        const value = String(values[f.key] ?? "");
        return (
          <div key={f.key} className="rw-row-field">
            <span className="rw-label">{f.label}</span>
            <div className="rw-form">
              {value && f.type === "image" && <img className="rw-file" src={value} alt="" />}
              {value && f.type === "file" && <a href={value} target="_blank" rel="noreferrer">{value}</a>}
              {!value && <span className="rw-faint">Nothing yet</span>}
              {canEdit && !locked.has(f.key) && (
                <input className="rw-input" aria-label={f.label} placeholder="Address of the file" defaultValue={value} onBlur={(e) => { if (e.target.value !== value) void onSave({ [f.key]: e.target.value }); }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RelatedList({ columns, rows, onOpen, empty }: RelatedListProps) {
  if (!rows.length) return <p className="rw-faint">{empty}</p>;
  return <Table columns={columns} rows={rows} onOpen={onOpen} />;
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
