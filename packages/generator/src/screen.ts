import type { Spec } from "@redwood/spec";
import { columnName, tableName } from "@redwood/migrations";
import type { PartName, UiKit } from "@redwood/parts";
import type { ScreenPlan } from "@redwood/planner";
import "./blocks";
import "./layouts";
import { findColumn, roleSlug, SpecError } from "./model";
import { emitRecord, recordComponent, rowHandlers } from "./record";
import { getBlock, getLayout, getNamedBlock, type Gap, type PageCtx, type SlotId } from "./registry";
import { pascal, slug } from "./util";

const str = (s: string) => JSON.stringify(s);
const lower = (s: string) => s.toLowerCase();
const SLOTS: SlotId[] = ["actions", "toolbar", "main", "overlays", "footer"];

export interface ScreenOutput {
  source: string;
  /** Files created once and never overwritten (developer-written blocks). */
  scaffold: Record<string, string>;
  /** The page one record opens on, when this screen has one. */
  record?: string;
}

/** The file a developer fills in when a screen names a block Redwood has no template for. */
function blockScaffold(ctx: PageCtx, id: string, component: string, file: string): string {
  const stories = ctx.screen.stories
    .map((sid) => ctx.spec.stories.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ` *   - As the ${ctx.spec.roles.find((r) => r.id === s.role)?.name ?? s.role}, I want to ${s.action}`);
  return `import { Placeholder } from "../../src/web/ui";
import type { BlockProps } from "../../src/web/ui/contract";

/**
 * Block "${id}" on the "${ctx.screen.title}" screen (${ctx.screen.path}).
 *
 * Redwood has no template for this block, so the screen shows a placeholder. Replace the body with the
 * real thing. Redwood never overwrites this file. The page loads the data and checks permissions; this
 * component only renders what it is given.
 *
 * Stories this screen serves:
${stories.join("\n") || " *   (none recorded)"}
 *
 * Columns you receive: ${ctx.entity.fields.map((f) => f.name).join(", ")}
 */
export default function ${component}({ title, rows, columns, role }: BlockProps) {
  void title; void rows; void columns; void role;
  return <Placeholder what=${str(`the “${id}” block on ${ctx.screen.title}`)} where=${str(file)} />;
}
`;
}

function namedBlocks(ctx: PageCtx): string[] {
  return ctx.plan.blocks.map(({ id }) => {
    const known = getNamedBlock(id);
    if (known) return known.render(ctx);
    const component = pascal(id);
    const file = `custom/blocks/${component}.tsx`;
    ctx.gaps.push({ what: `${ctx.plan.screen}:block:${id}`, why: `Redwood has no template for block "${id}"; build it in ${file}`, file });
    ctx.scaffold[file] = blockScaffold(ctx, id, component, file);
    ctx.extraImports.push(`import ${component} from "../../../custom/blocks/${component}";`);
    return `      <${component} title=${str(ctx.screen.title)} rows={visible} columns={columns} role={me.role} />`;
  });
}

/**
 * One page per screen: a scaffold that owns the data, around the slots the chosen layout fills with blocks.
 * Anything the kit has no part for becomes a visible placeholder that names what is missing; nothing is
 * silently left out.
 */
export function emitScreen(spec: Spec, plan: ScreenPlan, kit: UiKit, gaps: Gap[]): ScreenOutput {
  const screen = spec.screens.find((s) => s.id === plan.screen)!;
  const name = `${pascal(plan.screen)}Screen`;
  const entity = spec.entities.find((e) => e.id === plan.entity);

  if (!entity) {
    gaps.push({ what: plan.screen, why: plan.placeholders[0]?.why ?? "screen has no entity" });
    return {
      source: `import { Page, Placeholder } from "../ui";

export default function ${name}() {
  return (
    <Page title=${str(screen.title)}>
      <Placeholder what=${str(`the “${screen.title}” screen`)} />
    </Page>
  );
}
`,
      scaffold: {},
    };
  }

  const table = tableName(entity);
  const word = lower(entity.name);
  const wfCol = entity.workflow ? findColumn(entity, entity.workflow.field, "workflow field") : undefined;
  const has = (p: PartName) => plan.items.some((i) => i.part === p);
  const answer = (id: string) => plan.answers[id]?.answer === true;
  const used = new Set<string>(["Page"]);

  const part = (p: PartName, jsx: () => string): string => {
    if (kit.missing.includes(p)) {
      gaps.push({ what: `${plan.screen}:${p}`, why: `kit ${kit.name} has no ${p}` });
      used.add("Placeholder");
      const words = p.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      return `<Placeholder what=${str(`the ${words} on ${screen.title}`)} />`;
    }
    used.add(p);
    return jsx();
  };
  const ok = (p: PartName) => has(p) && !kit.missing.includes(p);

  const dialogOk = !kit.missing.includes("Dialog");
  const flags = {
    canCreate: answer("can-create") && has("Form"),
    canEdit: answer("can-edit") && has("Form"),
    canDelete: answer("can-delete") && dialogOk && plan.layout !== "form-page",
    dialogOk,
    detail: ok("RecordPage"),
    states: has("StateButtons") && !!wfCol,
  };
  const customs = plan.actions;

  // ---- per-row buttons: workflow moves and custom actions
  const rowButtons: string[] = [];
  if (flags.states) {
    used.add("StateButtons");
    rowButtons.push(`      {can(me.role, ${str(table)}, "update") && (
        <StateButtons next={nextStates(me.role, ${str(table)}, String(row[${str(wfCol!)}]))} onMove={(to) => void move(row, to)} />
      )}`);
  }
  for (const a of customs) {
    used.add("Button");
    rowButtons.push(`      {can(me.role, ${str(table)}, "update") && (
        <Button size="small" onClick={() => void act(row, ${str(slug(a.action))}, ${str(a.label)})}>${a.label.replace(/[{}<>]/g, "")}</Button>
      )}`);
  }
  const rowActionsProp = rowButtons.length
    ? `
          rowActions={(row) => (
            <>
${rowButtons.join("\n")}
            </>
          )}`
    : "";

  const scaffold: Record<string, string> = {};
  const extraImports: string[] = [];
  const ctx: PageCtx = {
    spec, plan, screen, entity, kit, gaps, table, word, wfCol, used, extraImports, scaffold,
    has, ok, answer, part, flags, customs, rowButtons, rowActionsProp,
    newButton(label) {
      used.add("Button");
      return `<Button variant="primary" onClick={() => setEditing("new")}>${label}</Button>`;
    },
  };

  // ---- the layout composes blocks into slots
  const layout = getLayout(plan.layout);
  if (!layout) throw new SpecError(`${plan.screen}: no layout "${plan.layout}" is registered`);
  const slots = {} as Record<SlotId, string>;
  for (const slot of SLOTS) {
    const rendered = layout.blocks[slot].flatMap((id) => {
      if (id === "named-blocks") return namedBlocks(ctx);
      const block = getBlock(id);
      if (!block) throw new SpecError(`layout "${layout.id}" uses block "${id}", which is not registered`);
      const out = block.render(ctx);
      return out ? [out] : [];
    });
    slots[slot] = slot === "actions" ? (rendered[0] ?? "") : rendered.join("\n");
  }

  const refTables = [
    ...new Set(
      entity.fields
        .filter((f) => f.type === "reference" && f.references)
        .map((f) => tableName(spec.entities.find((e) => e.id === f.references)!)),
    ),
  ].sort();

  // What the signed-in role is here to do, in the words of its own first story for this screen.
  const stories: Record<string, string> = {};
  for (const role of spec.roles) {
    const s = spec.stories.find((x) => x.role === role.id && screen.stories.includes(x.id));
    if (s) stories[roleSlug(role.id)] = `As the ${role.name}, I want to ${s.action}.`;
  }

  const body = Object.values(slots).join("\n");
  const needsNotify = body.includes("notify(") || flags.states || customs.length > 0;
  const imports = ["Page", ...[...used].filter((u) => u !== "Page")].sort();

  // A screen can narrow what it shows; hidden columns are still filtered first, so this never widens access.
  const shown = screen.fields.flatMap((id) => entity.fields.filter((f) => f.id === id).map(columnName));
  const shownColumns = shown.length ? `\n    .filter((c) => ${JSON.stringify(shown)}.includes(c.key))` : "";

  const source = `import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ${imports.join(", ")}${needsNotify ? ", notify" : ""} } from "../ui";
import { formatValue } from "../format";
import type { FormField, Row } from "../ui/contract";
import { recordLabel, ${customs.length ? "runAction, " : ""}useMe, useRecords } from "../api";
import { models } from "../../shared/model";
import { can, hiddenColumns, nextStates, ownerColumn } from "../../shared/policy";
${extraImports.join("\n")}${extraImports.length ? "\n" : ""}
const model = models[${str(table)}]!;

/** The signed-in role's own story for this screen, shown under the title. */
const STORY: Record<string, string> = ${JSON.stringify(stories)};

export default function ${name}() {
  const me = useMe();
  const { rows, loading, error, create, update, remove } = useRecords(${str(table)}, can(me.role, ${str(table)}, "list"));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const navigate = useNavigate();
  const [formError, setFormError] = useState("");
  const [gap, setGap] = useState<string | null>(null);
${plan.layout === "form-page" ? "  const [formKey, setFormKey] = useState(0);\n" : ""}${refTables.map((t) => `  const ref_${t} = useRecords(${str(t)}, can(me.role, ${str(t)}, "list"));`).join("\n")}

  // A reference shows the referenced record's name. A role that may not list that table gets no names
  // and no picker: access rules are never bypassed to make a label prettier.
  const lookups: Record<string, Record<string, string>> = {
${refTables.map((t) => `    ${t}: Object.fromEntries(ref_${t}.rows.map((r) => [String(r.id), recordLabel(r, models[${str(t)}]!.display)])),`).join("\n")}
  };

  // Columns the server hides from this role, and columns the server fills in itself, never reach the UI.
  const hidden = new Set(hiddenColumns(me.role, ${str(table)}));
  const columns: FormField[] = model.columns
    .filter((c) => !hidden.has(c.key))${shownColumns}
    .map((c) => ({ ...c, lookup: c.references ? (lookups[c.references] ?? {}) : undefined }));
  const server = new Set([ownerColumn(me.role, ${str(table)}), model.workflow?.column]);
  const fields: FormField[] = columns
    .filter((c) => !server.has(c.key))
    .map((c) => (c.lookup ? { ...c, choices: Object.entries(c.lookup).map(([value, label]) => ({ value, label })) } : c));
  const visible = rows.filter((r) =>
    !query ||
    columns.some((c) => formatValue(r[c.key], c).toLowerCase().includes(query.toLowerCase())),
  );

  const nameOf = (r: Row) => recordLabel(r, model.display);
  const editingRow = editing && editing !== "new" ? editing : null;
  const closeForm = () => {
    setEditing(null);
    setFormError("");
  };
${rowHandlers(ctx)}
  return (
${layout.shell(screen.title, slots)}
  );
}
`;
  return { source, scaffold, ...(flags.detail ? { record: emitRecord(ctx, recordComponent(plan.screen), refTables, shownColumns) } : {}) };
}
