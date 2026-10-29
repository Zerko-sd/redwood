import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkSpec, type Spec } from "@redwood/spec";
import { generate, MANIFEST_PATH, SPEC_COPY_PATH, type GenerateInput, type Manifest } from "./index";
import { sha, json } from "./util";

export class RegenerationRefused extends Error {
  constructor(public edited: string[]) {
    super(`these generated files were edited by hand; move your changes to custom/ or pass force:\n  - ${edited.join("\n  - ")}`);
  }
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

function readManifest(dir: string): Manifest | undefined {
  const text = read(join(dir, MANIFEST_PATH));
  return text ? (JSON.parse(text) as Manifest) : undefined;
}

/** Generated files whose contents no longer match the manifest. */
export function findEdited(dir: string): string[] {
  const manifest = readManifest(dir);
  if (!manifest) return [];
  const edited: string[] = [];
  for (const [path, hash] of Object.entries({ ...manifest.files, ...prefixed(manifest.migrations) })) {
    const text = read(join(dir, path));
    if (text !== undefined && sha(text) !== hash) edited.push(path);
  }
  return edited.sort();
}

const prefixed = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [`migrations/${k}`, v]));

export interface WriteOptions extends Pick<GenerateInput, "allowDestructive" | "kit"> {
  /** Overwrite hand-edited generated files. */
  force?: boolean;
}

/**
 * Generates into `dir`. Only touches files the previous run wrote, refuses if any were
 * hand-edited, never overwrites developer-owned files (custom/), and never rewrites a migration.
 */
export function writeApp(dir: string, spec: Spec, opts: WriteOptions = {}) {
  const edited = findEdited(dir);
  if (edited.length && !opts.force) throw new RegenerationRefused(edited);

  const old = readManifest(dir);
  const previousText = read(join(dir, SPEC_COPY_PATH));
  const previous = previousText ? checkSpec(JSON.parse(previousText)).spec ?? null : null;
  const migrationsDir = join(dir, "migrations");
  const existingMigrations = Object.fromEntries(
    (existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")) : []).map((f) => [
      f,
      sha(readFileSync(join(migrationsDir, f), "utf8")),
    ]),
  );

  const result = generate(spec, { previous, existingMigrations, allowDestructive: opts.allowDestructive, kit: opts.kit });
  // generate() is pure, so it reports every developer file as a gap. On disk we can see which ones a person
  // has since filled in: a gap stays open only while its file still renders the placeholder.
  result.manifest.needsDeveloper = result.manifest.needsDeveloper.filter((g) => {
    if (!g.file) return true;
    const text = read(join(dir, g.file));
    return text === undefined || text.includes("<Placeholder");
  });
  const put = (path: string, text: string) => {
    const full = join(dir, path);
    if (read(full) === text) return false;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return true;
  };

  const written: string[] = [];
  for (const [path, text] of Object.entries(result.files)) {
    if (path.startsWith("migrations/") && existingMigrations[path.slice("migrations/".length)]) continue; // append-only
    if (put(path, text)) written.push(path);
  }
  const removed: string[] = [];
  for (const path of Object.keys(old?.files ?? {})) {
    if (path in result.files) continue; // a file that is no longer generated is removed
    rmSync(join(dir, path), { force: true });
    removed.push(path);
  }
  const scaffolded: string[] = [];
  for (const [path, text] of Object.entries(result.scaffold)) {
    if (existsSync(join(dir, path))) continue;
    put(path, text);
    scaffolded.push(path);
  }
  put(MANIFEST_PATH, json(result.manifest) + "\n");
  return { manifest: result.manifest, written, removed, scaffolded };
}
