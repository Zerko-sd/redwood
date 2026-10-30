import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { createUser } from "./auth";
import { roles } from "../shared/policy";
import { models, seeds } from "../shared/model";

function insert(table: string, row: Record<string, unknown>): void {
  const values: Record<string, unknown> = { id: randomUUID(), ...row };
  const keys = Object.keys(values);
  db.prepare(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
  ).run(...(keys.map((k) => (typeof values[k] === "boolean" ? (values[k] ? 1 : 0) : values[k])) as never[])); // booleans are stored as 1/0, as in crud.ts
}

/**
 * Demo data for previews: one user per role (password "redwood") plus the spec's seed rows.
 * With `replace`, set only by the Builder's preview, rows are reloaded whenever the spec's sample rows change.
 * It is never set for a deployed app, so real data is never wiped. A half-filled row is skipped, not fatal.
 */
export function seedDemo(replace = false): void {
  for (const role of roles) {
    const exists = db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(role);
    if (!exists) createUser(role, "redwood", role);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS _seed_state (key TEXT PRIMARY KEY, hash TEXT NOT NULL)`);
  const hash = createHash("sha256").update(JSON.stringify(seeds)).digest("hex");
  const seen = db.prepare(`SELECT hash FROM _seed_state WHERE key = 'seeds'`).get() as { hash: string } | undefined;
  const changed = replace && !!seen && seen.hash !== hash;

  // Foreign keys are checked at COMMIT, so tables can load in any order and clear in any order.
  db.exec("BEGIN");
  try {
    db.exec("PRAGMA defer_foreign_keys = ON");
    if (changed) for (const table of Object.keys(models)) db.exec(`DELETE FROM "${table}"`);
    for (const [table, rows] of Object.entries(seeds)) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
      if (count.n > 0) continue;
      for (const row of rows) {
        try {
          insert(table, row);
        } catch (e) {
          console.warn(`skipped a sample row in ${table}: ${(e as Error).message}`);
        }
      }
    }
    db.prepare(`INSERT INTO _seed_state (key, hash) VALUES ('seeds', ?) ON CONFLICT (key) DO UPDATE SET hash = excluded.hash`).run(hash);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.warn(`sample rows were not loaded: ${(e as Error).message}`);
  }
}
