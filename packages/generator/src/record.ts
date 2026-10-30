import { columnName, tableName } from "@redwood/migrations";
import type { PageCtx } from "./registry";
import { pascal } from "./util";

const str = (s: string) => JSON.stringify(s);

/** Workflow moves and custom actions, shared by the list and the record page. Both pages hold the same names. */
export function rowHandlers(ctx: Pick<PageCtx, "flags" | "customs" | "table">): string {
  return `${ctx.flags.states ? `
  const move = async (row: Row, to: string) => {
    const err = await update(row.id, { [model.workflow!.column]: to });
    if (err) notify(err, "error");
    else notify(nameOf(row) + " is now " + to);
  };
` : ""}${ctx.customs.length ? `
  // Custom actions have no template: the server answers 501 until a developer builds them in custom/routes.ts.
  const act = async (row: Row, action: string, label: string) => {
    const r = await runAction(${str(ctx.table)}, row.id, action);
    if (r.ok) notify(label + " done");
    else if (r.notBuilt) setGap(label);
    else notify(r.message, "error");
  };
` : ""}`;
}

/**
 * One record on its own page: the header, a Details tab that edits in place, a Files tab when the table holds files,
 * and one tab per table that points at this one. The API remains the authority; this only hides what it would refuse.
 */
export function emitRecord(ctx: PageCtx, name: string, refTables: string[], shownColumns: string): string {
  const { spec, entity, table, screen, flags, customs } = ctx;
  const t = str(table);
  const fileCols = entity.fields.filter((f) => f.type === "file" || f.type === "image").map(columnName);
  const image = entity.fields.find((f) => f.type === "image");
  const related = spec.entities
    .filter((e) => e.fields.some((f) => f.type === "reference" && f.references === entity.id))
    .map((e) => {
      const f = e.fields.find((x) => x.type === "reference" && x.references === entity.id)!;
      const home = spec.screens.find((s) => s.entity === e.id && s.path !== "/");
      return { key: tableName(e), label: e.name, column: columnName(f), path: home?.path ?? null };
    });

  const parts = new Set(["Button", "Dialog", "EmptyState", "RecordDetails", "RecordPage"]);
  if (fileCols.length) parts.add("RecordFiles");
  if (related.length) parts.add("RelatedList");
  if (flags.states) parts.add("StateButtons");
  if (customs.length) parts.add("Placeholder");

  const buttons: string[] = [...ctx.rowButtons];
  if (flags.canDelete) {
    buttons.push(`      {can(me.role, ${t}, "delete") && <Button variant="danger" onClick={() => setConfirming(true)}>Delete</Button>}`);
  }

  return `import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ${[...parts].sort().join(", ")}, notify } from "../ui";
import { formatValue } from "../format";
import type { FormField, Row } from "../ui/contract";
import { recordLabel, ${customs.length ? "runAction, " : ""}useMe, useRecords } from "../api";
import { models } from "../../shared/model";
import { can, hiddenColumns, nextStates, ownerColumn, readOnlyColumns } from "../../shared/policy";

const model = models[${t}]!;

export default function ${name}() {
  const me = useMe();
  const { id } = useParams();
  const navigate = useNavigate();
  const { rows, loading, error, update, remove } = useRecords(${t}, can(me.role, ${t}, "list"));
  const [confirming, setConfirming] = useState(false);
  const [gap, setGap] = useState<string | null>(null);
${refTables.map((x) => `  const ref_${x} = useRecords(${str(x)}, can(me.role, ${str(x)}, "list"));`).join("\n")}
${related.map((r) => `  const rel_${r.key} = useRecords(${str(r.key)}, can(me.role, ${str(r.key)}, "list"));`).join("\n")}

  const lookups: Record<string, Record<string, string>> = {
${refTables.map((x) => `    ${x}: Object.fromEntries(ref_${x}.rows.map((r) => [String(r.id), recordLabel(r, models[${str(x)}]!.display)])),`).join("\n")}
  };
  const hidden = new Set(hiddenColumns(me.role, ${t}));
  const columns: FormField[] = model.columns
    .filter((c) => !hidden.has(c.key))${shownColumns}
    .map((c) => ({ ...c, lookup: c.references ? (lookups[c.references] ?? {}) : undefined }));
  const fields = columns.map((c) => (c.lookup ? { ...c, choices: Object.entries(c.lookup).map(([value, label]) => ({ value, label })) } : c));
  const fileKeys = new Set<string>(${JSON.stringify(fileCols)});
  // What the server fills in itself, and what this role may read but not change, stay visible and stay still.
  const locked = new Set<string>([...readOnlyColumns(me.role, ${t}), ...[ownerColumn(me.role, ${t}), model.workflow?.column].filter((k): k is string => !!k)]);
  const back = () => navigate(${str(screen.path)});
  const row = rows.find((r) => String(r.id) === id) ?? null;
  const nameOf = (r: Row) => recordLabel(r, model.display);
${rowHandlers(ctx)}
  if (loading) return <EmptyState title="Loading…" />;
  if (error) return <EmptyState title="Couldn't load this ${ctx.word}" hint={error} />;
  if (!row) return <EmptyState title="This ${ctx.word} isn't here" hint="It may have been removed, or you may not have access." action={<Button onClick={back}>Back to ${screen.title.replace(/[{}<>"]/g, "")}</Button>} />;

  const summary = columns
    .filter((c) => c.key !== model.display && !fileKeys.has(c.key))
    .slice(0, 2)
    .map((c) => formatValue(row[c.key], c))
    .filter(Boolean);
${related.map((r) => `  const related_${r.key} = rel_${r.key}.rows.filter((x) => String(x[${str(r.column)}]) === String(row.id));`).join("\n")}

  return (
    <>
      <RecordPage
        title={nameOf(row)}
        summary={summary}
        back={{ label: ${str(screen.title)}, onClick: back }}${image ? `
        image={row[${str(columnName(image))}] ? String(row[${str(columnName(image))}]) : undefined}` : ""}
        actions={
          <>
${buttons.join("\n")}
          </>
        }
        tabs={[
          {
            id: "details",
            label: "Details",
            content: (
              <RecordDetails
                key={String(row.id)}
                fields={fields.filter((f) => !fileKeys.has(f.key))}
                values={row}
                locked={locked}
                canEdit={can(me.role, ${t}, "update")}
                onSave={async (changes) => {
                  const err = await update(row.id, changes);
                  if (!err) notify(${str(`${entity.name} saved`)});
                  return err;
                }}
              />
            ),
          },${fileCols.length ? `
          {
            id: "files",
            label: "Files",
            content: <RecordFiles fields={fields.filter((f) => fileKeys.has(f.key))} values={row} locked={locked} canEdit={can(me.role, ${t}, "update")} onSave={(changes) => update(row.id, changes)} />,
          },` : ""}${related.map((r) => `
          ...(can(me.role, ${str(r.key)}, "list")
            ? [{
                id: ${str(r.key)},
                label: ${str(r.label)},
                count: related_${r.key}.length,
                content: <RelatedList columns={models[${str(r.key)}]!.columns.filter((c) => c.key !== ${str(r.column)} && !hiddenColumns(me.role, ${str(r.key)}).includes(c.key))} rows={related_${r.key}}${r.path ? ` onOpen={(x) => navigate(${str(r.path)} + "/" + x.id)}` : ""} empty=${str(`No ${r.label.toLowerCase()} records point here yet.`)} />,
              }]
            : []),`).join("")}
        ]}
      />
      <Dialog title={"Delete " + nameOf(row) + "?"} open={confirming} onClose={() => setConfirming(false)}>
        <p>This permanently removes the ${ctx.word}. It can’t be undone.</p>
        <div className="rw-form-actions">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirming(false);
              const err = await remove(row.id);
              if (err) return notify(err, "error");
              notify(${str(`${entity.name} deleted`)});
              back();
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>${customs.length ? `
      <Dialog title="Not built yet" open={gap !== null} onClose={() => setGap(null)}>
        <Placeholder what={"the “" + (gap ?? "") + "” action"} where="custom/routes.ts" />
        <div className="rw-form-actions">
          <Button onClick={() => setGap(null)}>Close</Button>
        </div>
      </Dialog>` : ""}
    </>
  );
}
`;
}

export const recordComponent = (screenId: string) => `${pascal(screenId)}Record`;
