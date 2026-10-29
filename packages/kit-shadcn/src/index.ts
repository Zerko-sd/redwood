import { readFileSync } from "node:fs";
import { THEME_TOKENS, type UiKit } from "@redwood/parts";

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/**
 * A shadcn-style kit: the same CSS-variable token names shadcn uses, with
 * hand-written components. Vendoring the real shadcn registry is a later step;
 * the parts contract is what keeps that swap cheap.
 */
export const shadcnKit: UiKit = {
  name: "shadcn",
  version: "0.2.0",
  missing: [],
  dependencies: {
    "@fontsource/ibm-plex-sans": "^5.1.0",
    "@fontsource/ibm-plex-sans-condensed": "^5.1.0",
  },
  files(tokens) {
    const vars = THEME_TOKENS.map((t) => `  --${t}: ${tokens[t]};`).join("\n");
    return {
      "components.tsx": read("components.tsx.tpl"),
      "kit.css": read("kit.css.tpl"),
      "theme.css": `@import "@fontsource/ibm-plex-sans/400.css";
@import "@fontsource/ibm-plex-sans/500.css";
@import "@fontsource/ibm-plex-sans/600.css";
@import "@fontsource/ibm-plex-sans-condensed/600.css";

:root {
${vars}
}
`,
      "index.ts": `export * from "./components";\n`,
    };
  },
};
