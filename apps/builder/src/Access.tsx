import { OPERATIONS } from "@redwood/spec/src/schema";
import { Empty, Section, Select, type EditorProps } from "./ui";

type Op = (typeof OPERATIONS)[number];
type Rule = EditorProps["spec"]["access"][number];
type Entity = EditorProps["spec"]["entities"][number];
type FieldRule = "hiddenFields" | "readOnlyFields";

const list = (text: string) => [...new Set(text.split(",").map((x) => x.trim()).filter(Boolean))];

export function Access({ spec, send, canEdit, tell }: EditorProps) {
  if (!spec.roles.length || !spec.entities.length) {
    return <div className="dock-body"><h2>Who can do what</h2><Empty>Add at least one role and one table first.</Empty></div>;
  }

  const toggle = (role: string, entity: string, op: Op, on: boolean) => {
    const rule = spec.access.find((a) => a.role === role && a.entity === entity);
    const ops = new Set<Op>(rule?.operations ?? []);
    if (on) ops.add(op); else ops.delete(op);
    const operations = OPERATIONS.filter((o) => ops.has(o));
    if (!operations.length) return void send([{ type: "revoke", role, entity }]);
    void send([{ type: "grant", rule: { role, entity, operations, hiddenFields: rule?.hiddenFields ?? [], readOnlyFields: rule?.readOnlyFields ?? [], ...(rule?.ownerField ? { ownerField: rule.ownerField } : {}) } }]);
  };

  const setOwner = (rule: Rule, ownerField: string) => {
    const { ownerField: _drop, ...rest } = rule;
    void send([{ type: "grant", rule: { ...rest, ...(ownerField ? { ownerField } : {}) } }]);
  };

  /** Field names typed by hand, checked here so the message names the field. */
  const setFields = (rule: Rule, e: Entity, key: FieldRule, text: string) => {
    const names = list(text);
    const unknown = names.find((n) => !e.fields.some((f) => f.name === n));
    if (unknown) return tell(`${e.name} has no field called "${unknown}".`);
    void send([{ type: "grant", rule: { ...rule, [key]: names } }]);
  };

  const workflow = (e: Entity, states: string) => {
    const names = list(states);
    if (!names.length) return void send([{ type: "setWorkflow", entity: e.id, workflow: null }]);
    const field = e.workflow?.field ?? e.fields.find((f) => f.type === "choice")?.name;
    if (!field) return tell(`Add a choice field to ${e.name} first: a workflow moves a record through its values.`);
    const kept = (e.workflow?.transitions ?? []).filter((t) => names.includes(t.from) && names.includes(t.to));
    void send([{ type: "setWorkflow", entity: e.id, workflow: { field, states: names, transitions: kept } }]);
  };

  const toggleMove = (e: Entity, from: string, to: string, role: string, on: boolean) => {
    const w = e.workflow!;
    const rest = w.transitions.filter((t) => !(t.from === from && t.to === to));
    const roles = new Set(w.transitions.find((t) => t.from === from && t.to === to)?.roles ?? []);
    if (on) roles.add(role); else roles.delete(role);
    void send([{ type: "setWorkflow", entity: e.id, workflow: { ...w, transitions: roles.size ? [...rest, { from, to, roles: [...roles] }] : rest } }]);
  };

  return (
    <div className="dock-body">
      <h2>Who can do what</h2>
      <p className="hint">Nothing is allowed unless it is ticked here. Limiting a role to their own rows needs a field that holds the signed-in user.</p>
      {spec.entities.map((e) => (
        <section key={e.id} className="review-block">
          <h3>{e.name}</h3>
          <div className="table-scroll">
            <table className="grid access">
              <thead>
                <tr><th>Role</th>{OPERATIONS.map((o) => <th key={o}>{o}</th>)}<th>Rows</th></tr>
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
                            options={[{ value: "", label: "All" }, ...e.fields.map((f) => ({ value: f.name, label: `${f.name} is me` }))]}
                            onChange={(v) => setOwner(rule, v)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {spec.access.filter((a) => a.entity === e.id).map((rule) => (
            <details key={rule.role} className="more">
              <summary>{spec.roles.find((r) => r.id === rule.role)?.name}: field rules</summary>
              <label className="field-rule">Can't see
                <FieldList value={rule.hiddenFields} disabled={!canEdit} onCommit={(v) => setFields(rule, e, "hiddenFields", v)} />
              </label>
              <label className="field-rule">Can see, can't change
                <FieldList value={rule.readOnlyFields} disabled={!canEdit} onCommit={(v) => setFields(rule, e, "readOnlyFields", v)} />
              </label>
            </details>
          ))}
          <details className="more">
            <summary>{e.workflow ? `Workflow on ${e.workflow.field}` : "Add a workflow"}</summary>
            <label className="field-rule">States, in order
              <FieldList value={e.workflow?.states ?? []} disabled={!canEdit} onCommit={(v) => workflow(e, v)} />
            </label>
            {e.workflow && e.workflow.states.length > 1 && (
              <div className="table-scroll">
                <table className="grid access">
                  <thead><tr><th>Move</th>{spec.roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
                  <tbody>
                    {e.workflow.states.flatMap((from) => e.workflow!.states.filter((to) => to !== from).map((to) => (
                      <tr key={`${from}>${to}`}>
                        <td>{from} → {to}</td>
                        {spec.roles.map((r) => (
                          <td key={r.id}>
                            <input
                              type="checkbox"
                              aria-label={`${r.name} moves ${from} to ${to}`}
                              disabled={!canEdit}
                              checked={!!e.workflow!.transitions.find((t) => t.from === from && t.to === to)?.roles.includes(r.id)}
                              onChange={(ev) => toggleMove(e, from, to, r.id, ev.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </section>
      ))}
    </div>
  );
}

function FieldList({ value, disabled, onCommit }: { value: string[]; disabled: boolean; onCommit: (v: string) => void }) {
  const text = value.join(", ");
  return (
    <input
      key={text}
      defaultValue={text}
      placeholder="comma-separated"
      disabled={disabled}
      onBlur={(e) => { if (e.target.value !== text) onCommit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

export { Section };
