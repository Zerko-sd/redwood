import { useEffect, useState, type ReactNode } from "react";
import type { Command } from "./api";

/** What every editor receives: the current spec and the one way to change it. */
export interface EditorProps {
  spec: import("./api").Spec;
  send: (commands: Command[]) => Promise<boolean>;
  /** Shows a message in the notice bar, for refusals the Builder makes before anything reaches the server. */
  tell: (text: string) => void;
  canEdit: boolean;
}

/** A text box that sends its value when you leave it or press Enter, and only if it changed. */
export function Text({
  value, onCommit, placeholder, disabled, allowEmpty, wide, label,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  wide?: boolean;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === value) return;
    if (!v && !allowEmpty) return setDraft(value);
    onCommit(v);
  };
  return (
    <input
      className={wide ? "wide" : undefined}
      aria-label={label ?? placeholder}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function Select<T extends string>({
  value, options, onChange, disabled, label,
}: {
  value: T;
  options: readonly { value: T; label: string }[] | readonly T[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o as T, label: o } : o));
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Section({ title, hint, children, aside }: { title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <div>
          <h2>{title}</h2>
          {hint && <p className="hint">{hint}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

/** The name of a spec item for display: `role:bus-driver` -> the role's own name. */
export const nameOf = (list: { id: string; name?: string; title?: string }[], id: string): string => {
  const hit = list.find((x) => x.id === id);
  return hit?.name ?? hit?.title ?? id;
};
