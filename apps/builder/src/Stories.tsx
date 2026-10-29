import { useState } from "react";
import { freshId } from "./api";
import { Empty, Section, Select, Text, nameOf, type EditorProps } from "./ui";

const PRIORITY = ["must", "should", "could"] as const;

export function Stories({ spec, send, canEdit }: EditorProps) {
  const [role, setRole] = useState("");
  const [action, setAction] = useState("");
  const [newRole, setNewRole] = useState("");
  const roleId = spec.roles.some((r) => r.id === role) ? role : (spec.roles[0]?.id ?? "");

  const addRole = async () => {
    const name = newRole.trim();
    if (!name) return;
    const id = freshId("role", name, spec.roles.map((r) => r.id));
    if (await send([{ type: "addRole", role: { id, name, description: "" } }])) {
      setNewRole("");
      setRole(id);
    }
  };

  const addStory = async () => {
    const text = action.trim();
    if (!text || !roleId) return;
    const id = freshId("story", text, spec.stories.map((s) => s.id));
    const story = { id, role: roleId, action: text, reason: "", acceptance: [], priority: "should" as const, status: "accepted" as const, origin: "human" as const, tags: [] };
    if (await send([{ type: "addStory", story }])) setAction("");
  };

  const served = (id: string) => spec.screens.filter((s) => s.stories.includes(id));

  return (
    <>
      <Section title="Who uses it" hint="Each role signs in to the app and sees only what the access rules give them.">
        <div className="chips">
          {spec.roles.map((r) => <span key={r.id} className="chip">{r.name}</span>)}
          {canEdit && (
            <form className="inline" onSubmit={(e) => { e.preventDefault(); void addRole(); }}>
              <input aria-label="New role" placeholder="Add a role, e.g. Driver" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
              <button disabled={!newRole.trim()}>Add</button>
            </form>
          )}
        </div>
      </Section>

      <Section title="What people need to do" hint="One story per line. Each one decides a screen, and every part of a screen is traced back to a story.">
        {canEdit && (
          <form className="add-row" onSubmit={(e) => { e.preventDefault(); void addStory(); }}>
            <Select label="Role" value={roleId} disabled={!spec.roles.length} options={spec.roles.map((r) => ({ value: r.id, label: r.name }))} onChange={setRole} />
            <input
              className="grow"
              aria-label="Story"
              placeholder={spec.roles.length ? "I want to book a class" : "Add a role first"}
              disabled={!spec.roles.length}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
            <button className="primary" disabled={!action.trim() || !roleId}>Add story</button>
          </form>
        )}

        {spec.stories.length === 0 ? (
          <Empty>No stories yet. Add the first thing someone needs to do.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr><th>Role</th><th>I want to</th><th>So that</th><th>Priority</th><th>Screen</th><th /></tr>
            </thead>
            <tbody>
              {spec.stories.map((s) => {
                const on = served(s.id);
                return (
                  <tr key={s.id}>
                    <td>
                      <Select label="Role" value={s.role} disabled={!canEdit} options={spec.roles.map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => void send([{ type: "updateStory", id: s.id, patch: { role: v } }])} />
                    </td>
                    <td><Text wide value={s.action} disabled={!canEdit} onCommit={(v) => void send([{ type: "updateStory", id: s.id, patch: { action: v } }])} /></td>
                    <td><Text wide allowEmpty value={s.reason} placeholder="optional" disabled={!canEdit} onCommit={(v) => void send([{ type: "updateStory", id: s.id, patch: { reason: v } }])} /></td>
                    <td><Select label="Priority" value={s.priority} options={PRIORITY} disabled={!canEdit} onChange={(v) => void send([{ type: "updateStory", id: s.id, patch: { priority: v } }])} /></td>
                    <td>{on.length ? on.map((x) => x.title).join(", ") : <span className="gap">no screen yet</span>}</td>
                    <td>{canEdit && <button className="ghost" title={`Remove story by ${nameOf(spec.roles, s.role)}`} onClick={() => void send([{ type: "removeStory", id: s.id }])}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
