import { useState } from "react";
// The schema file alone is browser-safe; the package index also pulls in node:crypto.
import { FIELD_TYPES } from "@redwood/spec/src/schema";
import { freshId, type Command } from "./api";
import { Empty, Section, Select, Text, type EditorProps } from "./ui";

type FieldType = (typeof FIELD_TYPES)[number];

export function Data({ spec, send, tell, canEdit }: EditorProps) {
  const [pick, setPick] = useState("");
  const [newEntity, setNewEntity] = useState("");
  const [newField, setNewField] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");

  const entity = spec.entities.find((e) => e.id === pick) ?? spec.entities[0];

  const addEntity = async () => {
    const name = newEntity.trim();
    if (!name) return;
    const id = freshId("entity", name, spec.entities.map((e) => e.id));
    if (await send([{ type: "addEntity", entity: { id, name, fields: [], relationships: [], seed: [] } }])) {
      setNewEntity("");
      setPick(id);
    }
  };

  /** A reference or choice is invalid until it has its target or options, so a type change carries them. */
  const typePatch = (type: FieldType, current: { options?: string[]; references?: string }): Record<string, unknown> | string => {
    if (type === "reference") {
      const target = spec.entities.find((e) => e.id !== entity?.id) ?? spec.entities[0];
      if (!target) return "Add another table first, to point the reference at.";
      return { type, references: current.references ?? target.id };
    }
    if (type === "choice") return { type, options: current.options?.length ? current.options : ["Option 1", "Option 2"] };
    return { type };
  };

  const changeType = (fieldId: string, type: FieldType, current: { options?: string[]; references?: string }) => {
    const patch = typePatch(type, current);
    if (typeof patch === "string") return tell(patch);
    void send([{ type: "updateField", entity: entity!.id, id: fieldId, patch } as Command]);
  };

  const addField = async () => {
    const name = newField.trim();
    if (!name || !entity) return;
    const id = freshId("field", name, entity.fields.map((f) => f.id));
    const extra = typePatch(newType, {});
    if (typeof extra === "string") return tell(extra);
    const field = { id, name, required: false, unique: false, ...extra } as Extract<Command, { type: "addField" }>["field"];
    if (await send([{ type: "addField", entity: entity.id, field }])) setNewField("");
  };

  return (
    <>
      <Section title="What it keeps track of" hint="Each table becomes a database table, an API and a screen. Fields decide the columns and the form.">
        <div className="chips">
          {spec.entities.map((e) => (
            <button key={e.id} className={`chip btn${e.id === entity?.id ? " on" : ""}`} onClick={() => setPick(e.id)}>
              {e.name} <small>{e.fields.length}</small>
            </button>
          ))}
          {canEdit && (
            <form className="inline" onSubmit={(e) => { e.preventDefault(); void addEntity(); }}>
              <input aria-label="New table" placeholder="Add a table, e.g. Bus" value={newEntity} onChange={(e) => setNewEntity(e.target.value)} />
              <button disabled={!newEntity.trim()}>Add</button>
            </form>
          )}
        </div>
      </Section>

      {!entity ? (
        <Empty>No tables yet. Add one above, for example the main thing your people manage.</Empty>
      ) : (
        <Section
          title={entity.name}
          hint={entity.workflow ? `Workflow on "${entity.workflow.field}": ${entity.workflow.states.join(" → ")}` : undefined}
          aside={canEdit && <button className="ghost danger" onClick={() => void send([{ type: "removeEntity", id: entity.id }])}>Remove table</button>}
        >
          {entity.fields.length === 0 ? (
            <Empty>No fields yet.</Empty>
          ) : (
            <table className="grid">
              <thead><tr><th>Field</th><th>Type</th><th>Detail</th><th>Required</th><th>Unique</th><th /></tr></thead>
              <tbody>
                {entity.fields.map((f) => (
                  <tr key={f.id}>
                    <td><Text value={f.name} disabled={!canEdit} onCommit={(v) => void send([{ type: "updateField", entity: entity.id, id: f.id, patch: { name: v } }])} /></td>
                    <td><Select label="Type" value={f.type} options={FIELD_TYPES} disabled={!canEdit} onChange={(t) => changeType(f.id, t, f)} /></td>
                    <td>
                      {f.type === "choice" && (
                        <Text wide label="Options" value={(f.options ?? []).join(", ")} disabled={!canEdit} placeholder="comma-separated"
                          onCommit={(v) => void send([{ type: "updateField", entity: entity.id, id: f.id, patch: { options: v.split(",").map((x) => x.trim()).filter(Boolean) } }])} />
                      )}
                      {f.type === "reference" && (
                        <Select label="Points at" value={f.references ?? ""} disabled={!canEdit}
                          options={spec.entities.map((e) => ({ value: e.id, label: e.name }))}
                          onChange={(v) => void send([{ type: "updateField", entity: entity.id, id: f.id, patch: { references: v } }])} />
                      )}
                    </td>
                    <td><input type="checkbox" aria-label="Required" checked={f.required} disabled={!canEdit} onChange={(e) => void send([{ type: "updateField", entity: entity.id, id: f.id, patch: { required: e.target.checked } }])} /></td>
                    <td><input type="checkbox" aria-label="Unique" checked={f.unique} disabled={!canEdit} onChange={(e) => void send([{ type: "updateField", entity: entity.id, id: f.id, patch: { unique: e.target.checked } }])} /></td>
                    <td>{canEdit && <button className="ghost" onClick={() => void send([{ type: "removeField", entity: entity.id, id: f.id }])}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canEdit && (
            <form className="add-row" onSubmit={(e) => { e.preventDefault(); void addField(); }}>
              <input className="grow" aria-label="New field" placeholder="Add a field, e.g. Plate number" value={newField} onChange={(e) => setNewField(e.target.value)} />
              <Select label="Type" value={newType} options={FIELD_TYPES} onChange={setNewType} />
              <button className="primary" disabled={!newField.trim()}>Add field</button>
            </form>
          )}
        </Section>
      )}
    </>
  );
}
