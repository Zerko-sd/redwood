import { randomUUID } from "node:crypto";
import { db } from "./db";
import { createUser } from "./auth";
import { roles } from "../shared/policy";
import { seeds } from "../shared/model";

/** Demo data for previews: one user per role (password "redwood") plus the spec's seed rows. */
export function seedDemo(): void {
  for (const role of roles) {
    const exists = db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(role);
    if (!exists) createUser(role, "redwood", role);
  }
  for (const [table, rows] of Object.entries(seeds)) {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    if (count.n > 0) continue;
    for (const row of rows) {
      const values: Record<string, unknown> = { id: randomUUID(), ...row };
      const keys = Object.keys(values);
      db.prepare(
        `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      ).run(...(keys.map((k) => (typeof values[k] === "boolean" ? (values[k] ? 1 : 0) : values[k])) as never[])); // booleans are stored as 1/0, as in crud.ts
    }
  }
}
