import { useEffect, useMemo, useRef, useState } from "react";
import type { Spec } from "./api";
import { columnsOf, specToRows, tabsFor } from "./sheet/bind";
import type { Spot } from "./sheet/Grid";

export interface PaletteCommand { name: string; run: () => void }
interface Entry { key: string; label: string; detail: string; run: () => void }

/** Ctrl+K: every sheet, every row, and the things you can do, from one box. */
export function Palette({ spec, commands, onJump, onClose }: { spec: Spec; commands: PaletteCommand[]; onJump: (tab: string, spot?: Spot) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const entries = useMemo(() => {
    const all: Entry[] = [];
    for (const c of commands) all.push({ key: `c:${c.name}`, label: c.name, detail: "Action", run: c.run });
    for (const t of tabsFor(spec)) {
      all.push({ key: `t:${t.id}`, label: t.name, detail: "Sheet", run: () => onJump(t.id) });
      if (t.fixed) continue;
      const cols = columnsOf(spec, t.id);
      for (const r of specToRows(spec, t.id)) {
        const first = cols.map((c) => r.cells[c.key]).find(Boolean) ?? "";
        const words = Object.values(r.cells).filter(Boolean).join(" · ");
        all.push({ key: `r:${t.id}:${r.id}`, label: cols.length > 1 ? words : first, detail: t.name, run: () => onJump(t.id, { rowId: r.id, col: cols[0]?.key ?? "" }) });
      }
    }
    const q = text.trim().toLowerCase();
    const hits = q ? all.filter((e) => `${e.label} ${e.detail}`.toLowerCase().includes(q)) : all.filter((e) => !e.key.startsWith("r:"));
    return hits.slice(0, 40);
  }, [spec, commands, text, onJump]);

  const go = (e: Entry | undefined) => { if (e) { onClose(); e.run(); } };

  return (
    <div className="palette-scrim" onPointerDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onPointerDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          placeholder="Search rows, sheets and actions"
          value={text}
          onChange={(e) => { setText(e.target.value); setIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(entries.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") go(entries[index]);
            if (e.key === "Escape") onClose();
          }}
        />
        <ul>
          {entries.length === 0 && <li className="none">Nothing matches</li>}
          {entries.map((e, i) => (
            <li key={e.key} className={i === index ? "at" : ""} onPointerEnter={() => setIndex(i)} onPointerDown={() => go(e)}>
              <span>{e.label}</span><small>{e.detail}</small>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
