import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Loaded through require so bundlers/test runners that don't know "node:sqlite" leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const db = new DatabaseSync(process.env.DB_PATH ?? "app.db");
db.exec("PRAGMA foreign_keys = ON");

/** Applies migrations/*.sql in name order, once each. */
export function migrate(): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)`);
  const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  const applied = new Set(
    (db.prepare(`SELECT name FROM _migrations`).all() as { name: string }[]).map((r) => r.name),
  );
  const ran: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(dir + name, "utf8"));
      db.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(name);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    ran.push(name);
  }
  return ran;
}
