import { useEffect, useState } from "react";
import { api, type ProjectRow, type User } from "./api";

export function Projects({ user, onOpen, onSignOut }: { user: User; onOpen: (id: string) => void; onSignOut: () => void }) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [name, setName] = useState("");
  const [example, setExample] = useState(false);
  const [error, setError] = useState("");
  const [sure, setSure] = useState("");

  const load = () => api.projects().then(setRows).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => void load(), []);

  const create = async () => {
    try {
      const { id } = await api.createProject(name.trim(), example ? "example" : "blank");
      onOpen(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page narrow">
      <header className="topbar">
        <h1>Redwood</h1>
        <span className="spacer" />
        <span className="muted">{user.username}</span>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </header>

      <h2>Your projects</h2>
      {error && <p className="error">{error}</p>}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">No projects yet. Start one below.</p> : (
        <ul className="plain">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="row-link" onClick={() => onOpen(r.id)}>
                <strong>{r.name}</strong>
                <span className="muted">{r.role} · rev {r.rev}{r.updatedAt ? ` · ${new Date(r.updatedAt).toLocaleDateString()}` : ""}</span>
              </button>
              {r.role === "owner" && (sure === r.id ? (
                <>
                  <button className="ghost danger" onClick={() => { setSure(""); api.deleteProject(r.id).then(load).catch((e) => setError(e.message)); }}>Delete it and its history</button>
                  <button className="ghost" onClick={() => setSure("")}>Keep</button>
                </>
              ) : (
                <button className="ghost danger" onClick={() => setSure(r.id)}>Delete</button>
              ))}
            </li>
          ))}
        </ul>
      )}

      <h2>New project</h2>
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="grow" aria-label="Project name" placeholder="Name, e.g. Bus Fleet" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="check"><input type="checkbox" checked={example} onChange={(e) => setExample(e.target.checked)} /> Start from the Bus Fleet example</label>
        <button className="primary" disabled={!name.trim()}>Create</button>
      </form>
    </div>
  );
}
