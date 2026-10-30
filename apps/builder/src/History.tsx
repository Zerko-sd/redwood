import type { HistoryEntry } from "./api";
import { Empty, Section } from "./ui";

export function History({ entries, current, canEdit, onRestore }: { entries: HistoryEntry[]; current: number; canEdit: boolean; onRestore: (rev: number) => void }) {
  return (
    <div className="dock-body">
    <Section title="History" hint="Every change is a revision. Restoring one adds a new revision on top; nothing is erased.">
      {entries.length === 0 ? <Empty>No history yet.</Empty> : (
        <table className="grid">
          <thead><tr><th>Rev</th><th>What changed</th><th>By</th><th>When</th><th /></tr></thead>
          <tbody>
            {entries.map((h) => (
              <tr key={h.rev}>
                <td>{h.rev}{h.rev === current && <span className="chip small">now</span>}</td>
                <td>{h.label ? <b>{h.label}: </b> : null}{h.summary}</td>
                <td>{h.author ?? "—"}</td>
                <td>{new Date(h.createdAt).toLocaleString()}</td>
                <td>{canEdit && h.rev !== current && <button className="ghost" onClick={() => onRestore(h.rev)}>Restore</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
    </div>
  );
}
