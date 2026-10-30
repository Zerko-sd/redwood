import type { Entity, Field, Spec } from "@redwood/spec";
import { OPERATIONS } from "@redwood/spec";
import { columnName, tableName } from "@redwood/migrations";
import { findColumn, roleSlug } from "./model";
import { json } from "./util";

/** A value that satisfies a column, so tests can insert rows without going through the API. */
function sample(f: Field): string | number {
  switch (f.type) {
    case "number": case "money": case "percent": case "rating": return f.min ?? 1;
    case "boolean": return 0;
    case "choice": return f.options?.[0] ?? "";
    case "date": return "2026-01-01";
    case "datetime": return "2026-01-01T09:00";
    case "email": return "test@example.com";
    default: return "x";
  }
}

function sampleRow(e: Entity): Record<string, string | number> {
  return Object.fromEntries(e.fields.map((f) => [columnName(f), sample(f)]));
}

const REQUEST: Record<(typeof OPERATIONS)[number], { method: string; path: (t: string) => string; body?: object }> = {
  list: { method: "GET", path: (t) => `/api/${t}` },
  read: { method: "GET", path: (t) => `/api/${t}/missing` },
  create: { method: "POST", path: (t) => `/api/${t}`, body: {} },
  update: { method: "PATCH", path: (t) => `/api/${t}/missing`, body: {} },
  delete: { method: "DELETE", path: (t) => `/api/${t}/missing` },
};

/**
 * tests/access.test.ts for the generated app. Expectations are written out from the
 * spec's matrix here, independently of the policy.ts the server runs, so a bug in
 * either one shows up as a failure.
 */
export function emitAccessTest(spec: Spec): string {
  const roles = spec.roles.map((r) => roleSlug(r.id));
  const matrix: Record<string, Record<string, string[]>> = {};
  const ownerCases: unknown[] = [];
  const samples: Record<string, Record<string, string | number>> = {};
  const refs: Record<string, Record<string, string>> = {};
  const unique: Record<string, string[]> = {};
  const refCases: unknown[] = [];
  const byId = new Map(spec.entities.map((x) => [x.id, x]));
  const workflowCases: unknown[] = [];

  for (const e of spec.entities) {
    const table = tableName(e);
    samples[table] = sampleRow(e);
    unique[table] = e.fields.filter((f) => f.unique).map(columnName);
    for (const f of e.fields) {
      const target = f.type === "reference" && f.references ? byId.get(f.references) : undefined;
      if (!target) continue;
      (refs[table] ??= {})[columnName(f)] = tableName(target);
      const grants = (entity: Entity, op: string) =>
        roles.filter((r) => spec.access.some((a) => roleSlug(a.role) === r && a.entity === entity.id && a.operations.includes(op as never)));
      const createRole = grants(e, "create")[0] ?? null;
      // A delete under a row-level rule is filtered to the owner's rows, so it can't show the foreign-key refusal.
      const deleteRole =
        grants(target, "delete").find((r) => !spec.access.find((a) => roleSlug(a.role) === r && a.entity === target.id)?.ownerField) ?? null;
      const hidden = createRole
        ? (spec.access.find((a) => roleSlug(a.role) === createRole && a.entity === e.id)?.hiddenFields ?? []).map((h) => findColumn(e, h, "hidden field"))
        : [];
      refCases.push({ table, column: columnName(f), target: tableName(target), createRole, deleteRole, hidden });
    }
    for (const role of roles) {
      const rule = spec.access.find((a) => roleSlug(a.role) === role && a.entity === e.id);
      (matrix[role] ??= {})[table] = rule ? [...rule.operations].sort() : [];
      if (rule?.ownerField) {
        ownerCases.push({ role, table, owner: findColumn(e, rule.ownerField, "ownerField") });
      }
      if (rule?.operations.includes("update") && e.workflow) {
        const wf = e.workflow;
        const from = wf.states[0]!;
        const allowed = wf.transitions.filter((t) => t.from === from && t.roles.map(roleSlug).includes(role)).map((t) => t.to);
        const forbidden = wf.states.find((s) => s !== from && !allowed.includes(s));
        if (forbidden) {
          workflowCases.push({
            role, table, column: findColumn(e, wf.field, "workflow field"), from, to: forbidden,
            owner: rule.ownerField ? findColumn(e, rule.ownerField, "ownerField") : null,
          });
        }
      }
    }
  }

  return `import { describe, expect, it } from "vitest";

process.env.DB_PATH = ":memory:";
const { db, migrate } = await import("../src/server/db");
const { createUser } = await import("../src/server/auth");
const { createApp } = await import("../src/server/app");

migrate();
const app = createApp();

const ROLES: string[] = ${json(roles)};
const MATRIX: Record<string, Record<string, string[]>> = ${json(matrix)};
const REQUESTS: Record<string, { method: string; path: string; body?: object }> = ${json(
    Object.fromEntries(OPERATIONS.map((op) => [op, { method: REQUEST[op].method, path: REQUEST[op].path("{table}"), body: REQUEST[op].body }])),
  )};
const OWNER_CASES: { role: string; table: string; owner: string }[] = ${json(ownerCases)};
const WORKFLOW_CASES: { role: string; table: string; column: string; from: string; to: string; owner: string | null }[] = ${json(workflowCases)};
const REF_CASES: { table: string; column: string; target: string; createRole: string | null; deleteRole: string | null; hidden: string[] }[] = ${json(refCases)};
const SAMPLES: Record<string, Record<string, unknown>> = ${json(samples)};
const REFS: Record<string, Record<string, string>> = ${json(refs)};
const UNIQUE: Record<string, string[]> = ${json(unique)};

const cookies: Record<string, string> = {};
for (const role of ROLES) {
  createUser(role, "pw-" + role, role);
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: role, password: "pw-" + role }),
  });
  cookies[role] = res.headers.get("set-cookie")!.split(";")[0]!;
}

const as = (role: string | null, method: string, path: string, body?: object) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(role ? { cookie: cookies[role]! } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

/** A valid row for a table: sample values, unique columns made unique, references pointing at real parent rows. */
const build = (table: string, row: Record<string, unknown> = {}, depth = 0): Record<string, unknown> => {
  const values: Record<string, unknown> = { ...SAMPLES[table], ...row };
  for (const [col, target] of Object.entries(REFS[table] ?? {})) {
    if (!(col in row) && depth < 3) values[col] = insert(target, {}, depth + 1);
  }
  for (const col of UNIQUE[table] ?? []) {
    if (col in row) continue;
    values[col] = typeof values[col] === "number" ? Math.floor(Math.random() * 1e9) : String(values[col]) + "-" + crypto.randomUUID().slice(0, 8);
  }
  return values;
};

const insert = (table: string, row: Record<string, unknown> = {}, depth = 0): string => {
  const values: Record<string, unknown> = { id: crypto.randomUUID(), ...build(table, row, depth) };
  const keys = Object.keys(values);
  db.prepare(\`INSERT INTO "\${table}" (\${keys.map((k) => \`"\${k}"\`).join(", ")}) VALUES (\${keys.map(() => "?").join(", ")})\`)
    .run(...(keys.map((k) => values[k]) as never[]));
  return values.id as string;
};

describe("authentication", () => {
  it("rejects a wrong password", async () => {
    const res = await as(null, "POST", "/api/login", { username: ROLES[0], password: "nope" });
    expect(res.status).toBe(401);
  });

  for (const [table] of Object.entries(MATRIX[ROLES[0]!] ?? {})) {
    it(\`requires sign-in for \${table}\`, async () => {
      expect((await as(null, "GET", \`/api/\${table}\`)).status).toBe(401);
    });
  }
});

describe("access matrix", () => {
  for (const role of ROLES) {
    for (const [table, granted] of Object.entries(MATRIX[role] ?? {})) {
      for (const [op, req] of Object.entries(REQUESTS)) {
        const allowed = granted.includes(op);
        it(\`\${role} \${allowed ? "may" : "may not"} \${op} \${table}\`, async () => {
          const res = await as(role, req.method, req.path.replace("{table}", table), req.body);
          if (allowed) expect([401, 403]).not.toContain(res.status);
          else expect(res.status).toBe(403);
        });
      }
    }
  }
});

describe("row-level rules", () => {
  for (const c of OWNER_CASES) {
    it(\`\${c.role} sees only their own \${c.table} rows\`, async () => {
      const mine = insert(c.table, { [c.owner]: c.role });
      const theirs = insert(c.table, { [c.owner]: "someone-else" });
      const list = (await (await as(c.role, "GET", \`/api/\${c.table}\`)).json()) as { id: string }[];
      expect(list.map((r) => r.id)).toContain(mine);
      expect(list.map((r) => r.id)).not.toContain(theirs);
      expect((await as(c.role, "GET", \`/api/\${c.table}/\${theirs}\`)).status).toBe(404);
    });
  }
});

describe("references", () => {
  for (const c of REF_CASES) {
    if (c.createRole) {
      const role = c.createRole;
      const body = (ref: string) => {
        const values = build(c.table, { [c.column]: ref });
        for (const h of c.hidden) delete values[h];
        return values;
      };
      it(\`\${role} cannot point \${c.table}.\${c.column} at a \${c.target} that does not exist\`, async () => {
        const res = await as(role, "POST", \`/api/\${c.table}\`, body("no-such-record"));
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain("does not exist");
      });
      it(\`\${role} can point \${c.table}.\${c.column} at an existing \${c.target}\`, async () => {
        const res = await as(role, "POST", \`/api/\${c.table}\`, body(insert(c.target)));
        expect(res.status).toBe(201);
      });
    }
    if (c.deleteRole) {
      const role = c.deleteRole;
      it(\`\${role} cannot delete a \${c.target} that a \${c.table} still uses\`, async () => {
        const child = insert(c.table);
        const row = db.prepare(\`SELECT "\${c.column}" AS ref FROM "\${c.table}" WHERE id = ?\`).get(child) as { ref: string };
        const res = await as(role, "DELETE", \`/api/\${c.target}/\${row.ref}\`);
        expect(res.status).toBe(409);
      });
    }
  }
});

describe("workflow", () => {
  for (const c of WORKFLOW_CASES) {
    it(\`\${c.role} cannot move \${c.table} from \${c.from} to \${c.to}\`, async () => {
      const id = insert(c.table, { [c.column]: c.from, ...(c.owner ? { [c.owner]: c.role } : {}) });
      const res = await as(c.role, "PATCH", \`/api/\${c.table}/\${id}\`, { [c.column]: c.to });
      expect(res.status).toBe(403);
    });
  }
});
`;
}

export { tableName };
