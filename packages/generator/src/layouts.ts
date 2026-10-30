import { registerLayout, type SlotId } from "./registry";

const str = (s: string) => JSON.stringify(s);

/** The page element every layout wraps its slots in. */
const page = (title: string, p: Record<SlotId, string>) => `    <Page
      title=${str(title)}
      subtitle={STORY[me.role]}
      actions={${p.actions || "undefined"}}
    >
${[p.toolbar, p.main, p.overlays, p.footer].filter(Boolean).join("\n")}
    </Page>`;

registerLayout({
  id: "list",
  description: "Records in a table. Each one opens on its own page.",
  blocks: {
    actions: ["new-button"],
    toolbar: ["search-count"],
    main: ["data-table"],
    overlays: ["form-dialog", "gap-dialog", "record-page"],
    footer: ["summary", "named-blocks"],
  },
  shell: page,
});

registerLayout({
  id: "board",
  description: "Records as cards in one column per workflow state.",
  blocks: {
    actions: ["new-button"],
    toolbar: ["search-count"],
    main: ["board"],
    overlays: ["form-dialog", "gap-dialog", "record-page"],
    footer: ["summary", "named-blocks"],
  },
  shell: page,
});

registerLayout({
  id: "form-page",
  description: "One form on the page, for a screen that only creates records.",
  blocks: {
    actions: [],
    toolbar: [],
    main: ["inline-form"],
    overlays: [],
    footer: ["named-blocks"],
  },
  shell: page,
});
