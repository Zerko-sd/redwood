import { registerBlock, type PageCtx } from "./registry";
import { findColumn } from "./model";
import { slug } from "./util";

const str = (s: string) => JSON.stringify(s);
const lower = (s: string) => s.toLowerCase();

/** The loading / error / empty / no-match states every list shares, around whatever shows the rows. */
function listStates(ctx: PageCtx, inner: string): string {
  ctx.used.add("EmptyState");
  const title = lower(ctx.screen.title);
  return `      {!can(me.role, ${str(ctx.table)}, "list") ? null : loading ? (
        <EmptyState title="Loading…" />
      ) : error ? (
        <EmptyState title="Couldn't load ${title}" hint={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No ${title} yet"${ctx.flags.canCreate ? `
          action={can(me.role, ${str(ctx.table)}, "create") ? ${ctx.newButton(`Add the first ${ctx.word}`)} : undefined}` : ""}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No matches" hint={"Nothing matches “" + query + "”."} />
      ) : (
        ${inner}
      )}`;
}

registerBlock({
  id: "new-button",
  description: "The screen's main action, shown opposite the title.",
  render: (ctx) =>
    ctx.flags.canCreate
      ? `can(me.role, ${str(ctx.table)}, "create") ? ${ctx.newButton(`New ${ctx.word}`)} : undefined`
      : "",
});

registerBlock({
  id: "search-count",
  description: "Search box and the record count.",
  render(ctx) {
    if (!ctx.has("Toolbar")) return "";
    const search = ctx.has("SearchBox") ? ctx.part("SearchBox", () => `<SearchBox value={query} onChange={setQuery} />`) : "";
    const count = `<span className="rw-faint">{!loading && !error ? (visible.length === rows.length ? rows.length + (rows.length === 1 ? " record" : " records") : visible.length + " of " + rows.length) : ""}</span>`;
    let out = ctx.part("Toolbar", () => `<Toolbar>
        ${search}
        ${count}
      </Toolbar>`);
    if (ctx.kit.missing.includes("Toolbar")) out += `\n      ${search}`;
    return `      ${out}`;
  },
});

registerBlock({
  id: "data-table",
  description: "The records as a table, with the shared loading, error and empty states.",
  render(ctx) {
    if (!ctx.has("Table")) {
      ctx.used.add("EmptyState");
      return `      <EmptyState title=${str(ctx.plan.items.find((i) => i.part === "EmptyState")?.why ?? "Nothing to show")} />`;
    }
    const table = ctx.part("Table", () => `<Table
          columns={columns}
          rows={visible}${ctx.flags.detail ? `
          onOpen={(row) => navigate(${str(ctx.screen.path)} + "/" + row.id)}` : ""}${ctx.rowActionsProp}
        />`);
    return listStates(ctx, table);
  },
});

registerBlock({
  id: "board",
  description: "The records as cards in one column per workflow state.",
  render(ctx) {
    const board = ctx.part("Board", () => `<Board
          lanes={model.workflow!.states.map((s) => ({ id: s, title: s, rows: visible.filter((r) => String(r[${str(ctx.wfCol ?? "")}]) === s) }))}
          titleOf={(row) => nameOf(row)}
          detailsOf={(row) =>
            columns
              .filter((c) => c.key !== model.display && c.key !== ${str(ctx.wfCol ?? "")})
              .slice(0, 3)
              .map((c) => c.label + ": " + (formatValue(row[c.key], c) || "—"))
          }${ctx.flags.detail ? `
          onOpen={(row) => navigate(${str(ctx.screen.path)} + "/" + row.id)}` : ""}${ctx.rowActionsProp}
        />`);
    return listStates(ctx, board);
  },
});

registerBlock({
  id: "inline-form",
  description: "A create form that is the page itself, for a screen with nothing to list.",
  render(ctx) {
    ctx.used.add("Form");
    return `      <Form
        key={formKey}
        fields={fields}
        initial={null}
        error={formError}
        submitLabel="Create"
        onSubmit={async (values) => {
          const err = await create(values);
          if (err) return setFormError(err);
          notify(${str(`${ctx.entity.name} created`)});
          setFormError("");
          setFormKey((k) => k + 1);
        }}
      />`;
  },
});

registerBlock({
  id: "form-dialog",
  description: "Create and edit in a dialog, so the list stays in view.",
  render(ctx) {
    const out: string[] = [];
    if (ctx.has("Dialog") && !ctx.flags.dialogOk) out.push(ctx.part("Dialog", () => "")); // the kit has no dialog: say so on the page
    if (ctx.flags.dialogOk && (ctx.flags.canCreate || ctx.flags.canEdit)) {
      ctx.used.add("Form").add("Dialog");
      out.push(`      <Dialog
        title={editing === "new" ? ${str(`New ${ctx.word}`)} : ${str(`Edit ${ctx.word}`)}}
        open={editing !== null}
        onClose={closeForm}
      >
        <Form
          fields={fields}
          initial={editingRow}
          error={formError}
          submitLabel={editing === "new" ? "Create" : "Save changes"}
          onSubmit={async (values) => {
            const err = editingRow ? await update(editingRow.id, values) : await create(values);
            if (err) return setFormError(err);
            notify(editingRow ? ${str(`${ctx.entity.name} saved`)} : ${str(`${ctx.entity.name} created`)});
            closeForm();
          }}
          onCancel={closeForm}
        />
      </Dialog>`);
    }
    return out.join("\n");
  },
});

registerBlock({
  id: "gap-dialog",
  description: "What a custom action with no template shows when it is used.",
  render(ctx) {
    if (!ctx.customs.length || !ctx.flags.dialogOk) return "";
    ctx.used.add("Placeholder").add("Button").add("Dialog");
    return `      <Dialog title="Not built yet" open={gap !== null} onClose={() => setGap(null)}>
        <Placeholder what={"the “" + (gap ?? "") + "” action"} where="custom/routes.ts" />
        <div className="rw-form-actions">
          <Button onClick={() => setGap(null)}>Close</Button>
        </div>
      </Dialog>`;
  },
});

registerBlock({
  id: "record-page",
  description: "Records open on a page of their own. A kit with no such part shows where one belongs.",
  render(ctx) {
    return ctx.has("RecordPage") && !ctx.flags.detail ? ctx.part("RecordPage", () => "") : "";
  },
});

registerBlock({
  id: "summary",
  description: "One line of totals, when the screen asks for them.",
  render: (ctx) => (ctx.answer("shows-totals") ? `      ${ctx.part("StatCards", () => `<StatCards items={[{ label: ${str(lower(ctx.screen.title))}, value: rows.length }]} />`)}` : ""),
});

registerBlock({
  id: "named-blocks",
  description: "Blocks the spec names. A registered one renders; any other becomes a developer file and a placeholder.",
  render() {
    return ""; // resolved in screen.ts, which owns the scaffold files and imports
  },
});

export { findColumn, slug };
