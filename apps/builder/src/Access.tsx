import { OPERATIONS } from "@redwood/spec/src/schema";
import { Empty, Section, Select, type EditorProps } from "./ui";

type Op = (typeof OPERATIONS)[number];

export function Access({ spec, send, canEdit }: EditorProps) {
  if (!spec.roles.length || !spec.entities.length) {
    return <Section title="Who can do what"><Empty>Add at least one role and one table first.</Empty></Section>;
  }

  const toggle = (role: string, entity: string, op: Op, on: boolean) => {
    const rule = spec.access.find((a) => a.role === role && a.entity === entity);
    const ops = new Set<Op>(rule?.operations ?? []);
    if (on) ops.add(op); else ops.delete(op);
    const operations = OPERATIONS.filter((o) => ops.has(o));
    if (!operations.length) return void send([{ type: "revoke", role, entity }]);
    void send([{ type: "grant", rule: { role, entity, operations, hiddenFields: rule?.hiddenFields ?? [], ...(rule?.ownerField ? { ownerField: rule.ownerField } : {}) } }]);
  };

  const setOwner = (role: string, entity: string, ownerField: string) => {
    const rule = spec.access.find((a) => a.role === role && a.entity === entity);
    if (!rule) return;
    const { ownerField: _drop, ...rest } = rule;
    void send([{ type: "grant", rule: { ...rest, ...(ownerField ? { ownerField } : {}) } }]);
  };

  return (
    <Section title="Who can do what" hint="Nothing is allowed unless it is ticked here. Limiting a role to their own rows needs a field that holds the signed-in user.">
      {spec.entities.map((e) => (
        <table key={e.id} className="grid access">
          <caption>{e.name}</caption>
          <thead>
            <tr><th>Role</th>{OPERATIONS.map((o) => <th key={o}>{o}</th>)}<th>Own rows only</th></tr>
          </thead>
          <tbody>
            {spec.roles.map((r) => {
              const rule = spec.access.find((a) => a.role === r.id && a.entity === e.id);
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  {OPERATIONS.map((o) => (
                    <td key={o}>
                      <input type="checkbox" aria-label={`${r.name} can ${o} ${e.name}`} checked={!!rule?.operations.includes(o)} disabled={!canEdit} onChange={(ev) => toggle(r.id, e.id, o, ev.target.checked)} />
                    </td>
                  ))}
                  <td>
                    {rule && (
                      <Select
                        label="Own rows field"
                        value={rule.ownerField ?? ""}
                        disabled={!canEdit}
                        options={[{ value: "", label: "All rows" }, ...e.fields.map((f) => ({ value: f.id, label: `where ${f.name} is me` }))]}
                        onChange={(v) => setOwner(r.id, e.id, v)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </Section>
  );
}
