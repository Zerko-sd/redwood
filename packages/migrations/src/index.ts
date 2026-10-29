import type { Entity, Field, Spec } from "@redwood/spec";

export const snake = (s: string) =>
  s.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();

export const tableName = (e: Entity) => snake(e.name);
export const columnName = (f: Field) => snake(f.name);

export function sqlType(f: Field): string {
  switch (f.type) {
    case "number": return "REAL";
    case "money": case "boolean": return "INTEGER"; // money = minor units
    default: return "TEXT";
  }
}

function sqlDefault(f: Field): string | undefined {
  if (f.default !== undefined) {
    return typeof f.default === "string" ? `'${f.default.replace(/'/g, "''")}'` : String(Number(f.default));
  }
  return undefined;
}

function columnDef(f: Field, forAdd: boolean): string {
  let def = `"${columnName(f)}" ${sqlType(f)}`;
  let dflt = sqlDefault(f);
  // SQLite cannot add a NOT NULL column without a default.
  if (f.required && forAdd && dflt === undefined) dflt = sqlType(f) === "TEXT" ? "''" : "0";
  if (f.required) def += " NOT NULL";
  if (dflt !== undefined) def += ` DEFAULT ${dflt}`;
  return def;
}

export type Op =
  | { kind: "createTable"; entity: string }
  | { kind: "dropTable"; table: string; destructive: true }
  | { kind: "renameTable"; from: string; to: string }
  | { kind: "addColumn"; table: string; field: string }
  | { kind: "renameColumn"; table: string; from: string; to: string }
  | { kind: "dropColumn"; table: string; column: string; destructive: true }
  | { kind: "retypeColumn"; table: string; column: string; from: string; to: string; destructive: true };

export interface Migration {
  ops: Op[];
  sql: string;
  /** Human-readable list of data-losing steps; empty when the migration is safe. */
  destructive: string[];
}

/**
 * Reference fields get a real foreign key, so the database refuses dangling links and
 * deleting a record that is still referenced. (A column added later by ALTER TABLE cannot
 * carry one in SQLite; the API validates those references itself.)
 */
function createTableSql(e: Entity, tableOf: (id: string) => string | undefined): string {
  const cols = [`"id" TEXT PRIMARY KEY`, ...e.fields.map((f) => columnDef(f, false))];
  const uniques = e.fields.filter((f) => f.unique).map((f) => `UNIQUE ("${columnName(f)}")`);
  const keys = e.fields
    .filter((f) => f.type === "reference" && f.references && tableOf(f.references))
    .map((f) => `FOREIGN KEY ("${columnName(f)}") REFERENCES "${tableOf(f.references!)}" ("id")`);
  const body = [...cols, `"created_at" TEXT NOT NULL DEFAULT (datetime('now'))`, ...uniques, ...keys];
  return `CREATE TABLE "${tableName(e)}" (\n  ${body.join(",\n  ")}\n);`;
}

/**
 * Diffs two specs by stable ID. Same ID + new name = rename, never drop + add.
 * Destructive steps are listed and only emitted when allowDestructive is true.
 */
export function diffSpecs(prev: Spec | null, next: Spec, opts: { allowDestructive?: boolean } = {}): Migration {
  const ops: Op[] = [];
  const sql: string[] = [];
  const destructive: string[] = [];
  const prevEntities = new Map((prev?.entities ?? []).map((e) => [e.id, e]));
  const nextIds = new Set(next.entities.map((e) => e.id));
  const tableOf = (id: string) => {
    const hit = next.entities.find((e) => e.id === id);
    return hit && tableName(hit);
  };

  for (const e of next.entities) {
    const old = prevEntities.get(e.id);
    if (!old) {
      ops.push({ kind: "createTable", entity: e.id });
      sql.push(createTableSql(e, tableOf));
      continue;
    }
    const t = tableName(old);
    if (tableName(e) !== t) {
      ops.push({ kind: "renameTable", from: t, to: tableName(e) });
      sql.push(`ALTER TABLE "${t}" RENAME TO "${tableName(e)}";`);
    }
    const table = tableName(e);
    const oldFields = new Map(old.fields.map((f) => [f.id, f]));
    const nextFieldIds = new Set(e.fields.map((f) => f.id));
    for (const f of e.fields) {
      const of = oldFields.get(f.id);
      if (!of) {
        ops.push({ kind: "addColumn", table, field: f.id });
        sql.push(`ALTER TABLE "${table}" ADD COLUMN ${columnDef(f, true)};`);
      } else {
        if (columnName(of) !== columnName(f)) {
          ops.push({ kind: "renameColumn", table, from: columnName(of), to: columnName(f) });
          sql.push(`ALTER TABLE "${table}" RENAME COLUMN "${columnName(of)}" TO "${columnName(f)}";`);
        }
        if (sqlType(of) !== sqlType(f)) {
          const msg = `${table}.${columnName(f)} changes type ${sqlType(of)} -> ${sqlType(f)}`;
          destructive.push(msg);
          ops.push({ kind: "retypeColumn", table, column: columnName(f), from: sqlType(of), to: sqlType(f), destructive: true });
          if (opts.allowDestructive) {
            const c = columnName(f);
            sql.push(
              `ALTER TABLE "${table}" ADD COLUMN "${c}__new" ${sqlType(f)};`,
              `UPDATE "${table}" SET "${c}__new" = CAST("${c}" AS ${sqlType(f)});`,
              `ALTER TABLE "${table}" DROP COLUMN "${c}";`,
              `ALTER TABLE "${table}" RENAME COLUMN "${c}__new" TO "${c}";`,
            );
          }
        }
      }
    }
    for (const of of old.fields) {
      if (nextFieldIds.has(of.id)) continue;
      const msg = `${table}.${columnName(of)} is dropped (data is lost)`;
      destructive.push(msg);
      ops.push({ kind: "dropColumn", table, column: columnName(of), destructive: true });
      if (opts.allowDestructive) sql.push(`ALTER TABLE "${table}" DROP COLUMN "${columnName(of)}";`);
    }
  }
  for (const [id, old] of prevEntities) {
    if (nextIds.has(id)) continue;
    destructive.push(`table ${tableName(old)} is dropped (data is lost)`);
    ops.push({ kind: "dropTable", table: tableName(old), destructive: true });
    if (opts.allowDestructive) sql.push(`DROP TABLE "${tableName(old)}";`);
  }
  return { ops, sql: sql.join("\n\n") + (sql.length ? "\n" : ""), destructive };
}
