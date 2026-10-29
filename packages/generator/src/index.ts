import { canonicalJson, specHash, type Spec } from "@redwood/spec";
import { diffSpecs, tableName } from "@redwood/migrations";
import { DEFAULT_TOKENS, THEMES, type UiKit } from "@redwood/parts";
import { planApp } from "@redwood/planner";
import { shadcnKit } from "@redwood/kit-shadcn";
import { emitModel, emitPolicy } from "./model";
import { emitApp, emitHome, screenFile } from "./web";
import { emitScreen } from "./screen";
import { checkRegistries } from "./check";
import { SpecError } from "./model";
import type { Gap } from "./registry";
import { emitAccessTest } from "./tests";
import { json, sha, slug, sortedFiles, template, treeHash, type FileMap } from "./util";

export const GENERATOR = { name: "redwood", version: "0.1.0" };
export const MANIFEST_PATH = "redwood.manifest.json";
export const SPEC_COPY_PATH = "redwood.spec.json";

export interface Manifest {
  generator: typeof GENERATOR;
  specHash: string;
  kit: { name: string; version: string };
  /** sha256 of every generated file. A mismatch on disk means a person edited it. */
  files: Record<string, string>;
  /** Migrations are append-only: once written they are carried forward, never regenerated. */
  migrations: Record<string, string>;
  needsDeveloper: Gap[];
  treeHash: string;
}

export interface GenerateInput {
  /** The spec the app on disk was last generated from, if any. */
  previous?: Spec | null;
  /** Migration files already on disk (name -> sha256). */
  existingMigrations?: Record<string, string>;
  allowDestructive?: boolean;
  kit?: UiKit;
}

export interface GenerateResult {
  files: FileMap;
  /** Files created once and then owned by developers; the writer never overwrites them. */
  scaffold: FileMap;
  manifest: Manifest;
}

export class DestructiveMigrationError extends Error {
  constructor(public steps: string[]) {
    super(`migration would lose data:\n  - ${steps.join("\n  - ")}\nre-run with allowDestructive to accept`);
  }
}

const pad = (n: number) => String(n).padStart(4, "0");

/** Pure: the same spec (and inputs) always yields the same tree, byte for byte. */
export function generate(spec: Spec, input: GenerateInput = {}): GenerateResult {
  const kit = input.kit ?? shadcnKit;
  const gaps: Gap[] = [];
  const files: FileMap = {};
  const bad = checkRegistries(spec);
  if (bad.length) throw new SpecError(bad.map((i) => `${i.path}: ${i.message}`).join("; "));
  // A theme is a named set of token values; the spec's own tokens override single values on top of it.
  const tokens = { ...DEFAULT_TOKENS, ...THEMES[spec.theme.preset]!.tokens, ...spec.theme.tokens };
  const blockFiles: FileMap = {};

  // --- shared contract between API and UI
  files["src/shared/model.ts"] = emitModel(spec);
  files["src/shared/policy.ts"] = emitPolicy(spec);

  // --- server
  for (const f of ["db", "auth", "crud", "app", "main", "seed"]) files[`src/server/${f}.ts`] = template(`server/${f}.ts.tpl`);
  const stubs: { table: string; action: string }[] = [];
  for (const ep of spec.endpoints) {
    if (ep.operation !== "custom") continue;
    const table = tableName(spec.entities.find((e) => e.id === ep.entity)!);
    stubs.push({ table, action: slug(ep.action ?? ep.id) });
    gaps.push({ what: ep.id, why: `custom action "${ep.action}" on ${table} has no template` });
  }
  files["src/server/stubs.ts"] = template("server/stubs.ts.tpl").replace("__STUBS__", json(stubs));

  // --- web: kit components, parts contract, one page per planned screen
  Object.assign(files, Object.fromEntries(Object.entries(kit.files(tokens)).map(([k, v]) => [`src/web/ui/${k}`, v])));
  files["src/web/ui/contract.ts"] = template("web/contract.ts.tpl");
  files["src/web/api.ts"] = template("web/api.ts.tpl");
  files["src/web/format.ts"] = template("web/format.ts.tpl");
  files["src/web/main.tsx"] = template("web/main.tsx.tpl");
  files["src/web/App.tsx"] = emitApp(spec);
  files["src/web/Home.tsx"] = emitHome(spec, gaps);
  for (const plan of planApp(spec)) {
    const out = emitScreen(spec, plan, kit, gaps);
    files[screenFile(plan.screen)] = out.source;
    for (const [path, text] of Object.entries(out.scaffold)) blockFiles[path] ??= text; // first screen to ask writes the brief
  }

  // --- project files
  files["index.html"] = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>${spec.title.replace(/[<>&"]/g, "")}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
`;
  files["package.json"] = json({
    name: slug(spec.title),
    private: true,
    type: "module",
    scripts: {
      "dev:api": "tsx src/server/main.ts --seed",
      "dev:web": "vite",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: Object.fromEntries(
      Object.entries({
        "@hono/node-server": "^1.13.0",
        hono: "^4.6.0",
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        "react-router-dom": "^6.28.0",
        ...kit.dependencies,
      }).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    devDependencies: {
      "@types/node": "^22.10.0",
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      tsx: "^4.19.0",
      typescript: "^5.6.0",
      vite: "^5.4.0",
      vitest: "^2.1.0",
    },
    engines: { node: ">=22.13" },
  });
  files["tsconfig.json"] = json({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
      strict: true, noEmit: true, skipLibCheck: true, types: ["node"], lib: ["ES2023", "DOM", "DOM.Iterable"],
    },
    include: ["src", "tests", "custom", "vite.config.ts"],
  });
  files["vite.config.ts"] = `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": \`http://127.0.0.1:\${process.env.API_PORT ?? 8787}\` } },
});
`;
  files["src/web/vite-env.d.ts"] = `/// <reference types="vite/client" />\n`;
  files["tests/access.test.ts"] = emitAccessTest(spec);
  files["README.md"] = `# ${spec.title}

Generated by Redwood ${GENERATOR.version} from \`${SPEC_COPY_PATH}\`. Do not edit generated files; put your own code in \`custom/\`.

\`\`\`
npm install
npm run dev:api   # API on :8787, demo users (password "redwood") for: ${spec.roles.map((r) => r.id.replace("role:", "")).join(", ")}
npm run dev:web   # UI on :5173
npm test
\`\`\`
`;
  files[SPEC_COPY_PATH] = canonicalJson(spec);

  // --- migrations: append-only, diffed against the spec this app was last generated from
  const existing = input.existingMigrations ?? {};
  const names = Object.keys(existing).sort();
  const newMigrations: FileMap = {};
  // With no migration files on disk nothing was ever applied, whatever the old spec copy says.
  const prev = names.length ? (input.previous ?? null) : null;
  const diff = diffSpecs(prev, spec, { allowDestructive: input.allowDestructive });
  if (diff.destructive.length && !input.allowDestructive) throw new DestructiveMigrationError(diff.destructive);
  if (!names.length && !prev) newMigrations["migrations/0000_auth.sql"] = template("auth.sql.tpl");
  if (diff.sql) {
    const seq = names.length ? Number(names[names.length - 1]!.slice(0, 4)) + 1 : 1;
    newMigrations[`migrations/${pad(seq)}_${seq === 1 && !prev ? "init" : specHash(spec).slice(0, 8)}.sql`] = diff.sql;
  }
  Object.assign(files, newMigrations);

  const scaffold: FileMap = {
    "custom/routes.ts": `import type { Hono } from "hono";
import type { Env } from "../src/server/crud";

/** Your routes go here. Redwood never overwrites this file. */
export function customRoutes(_app: Hono<Env>): void {}
`,
    "custom/overrides.css": `/* Your CSS overrides go here. Redwood never overwrites this file. */\n`,
    ...blockFiles,
  };

  const sorted = sortedFiles(files);
  const migrationHashes: Record<string, string> = { ...existing };
  const generated: Record<string, string> = {};
  for (const [path, text] of Object.entries(sorted)) {
    if (path.startsWith("migrations/")) migrationHashes[path.slice("migrations/".length)] = sha(text);
    else generated[path] = sha(text);
  }
  const manifest: Manifest = {
    generator: GENERATOR,
    specHash: specHash(spec),
    kit: { name: kit.name, version: kit.version },
    files: generated,
    migrations: Object.fromEntries(Object.entries(migrationHashes).sort(([a], [b]) => (a < b ? -1 : 1))),
    needsDeveloper: gaps.sort((a, b) => (a.what < b.what ? -1 : 1)),
    treeHash: treeHash(sorted),
  };
  return { files: sorted, scaffold: sortedFiles(scaffold), manifest };
}

export { treeHash } from "./util";
export * from "./disk";
export { checkRegistries, registryProblems } from "./check";
export { registerBlock, registerLayout, registerNamedBlock, registeredLayouts, type BlockDef, type LayoutDef, type PageCtx, type Gap } from "./registry";
