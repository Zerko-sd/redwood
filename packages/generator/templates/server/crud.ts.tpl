import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { db } from "./db";
import type { User } from "./auth";
import type { Model } from "../shared/model";
import { can, canTransition, ownerColumn, hiddenColumns } from "../shared/policy";

type Row = Record<string, unknown>;
export type Env = { Variables: { user: User } };

const forbidden = (c: Context) => c.json({ error: "forbidden" }, 403);

function strip(model: Model, role: string, row: Row): Row {
  const hidden = new Set(hiddenColumns(role, model.table));
  return Object.fromEntries(Object.entries(row).filter(([k]) => !hidden.has(k)));
}

/** Checks a write body against the model. Returns an error message or the cleaned values. */
export function validate(
  model: Model,
  role: string,
  body: Row,
  partial: boolean,
): { error: string } | { values: Row } {
  const hidden = new Set(hiddenColumns(role, model.table));
  const values: Row = {};
  for (const col of model.columns) {
    if (hidden.has(col.key)) {
      if (col.key in body) return { error: `${col.label} is not writable` };
      continue;
    }
    const present = col.key in body && body[col.key] !== "" && body[col.key] != null;
    if (!present) {
      if (!partial && col.required && col.default === undefined) return { error: `${col.label} is required` };
      continue;
    }
    let v = body[col.key];
    if (col.type === "number" || col.type === "money") {
      v = Number(v);
      if (!Number.isFinite(v as number)) return { error: `${col.label} must be a number` };
      if (col.min !== undefined && (v as number) < col.min) return { error: `${col.label} must be at least ${col.min}` };
      if (col.max !== undefined && (v as number) > col.max) return { error: `${col.label} must be at most ${col.max}` };
    } else if (col.type === "boolean") {
      v = v === true || v === 1 || v === "true" ? 1 : 0;
    } else if (col.type === "reference") {
      v = String(v);
      const target = col.references && db.prepare(`SELECT 1 FROM "${col.references}" WHERE id = ?`).get(v as string);
      if (!target) return { error: `${col.label} refers to a record that does not exist` };
    } else {
      v = String(v);
      if (col.options && !col.options.includes(v as string)) {
        return { error: `${col.label} must be one of ${col.options.join(", ")}` };
      }
    }
    values[col.key] = v;
  }
  return { values };
}

export function mountCrud(app: Hono<Env>, model: Model): void {
  const base = `/api/${model.table}`;
  const owner = (role: string) => ownerColumn(role, model.table);
  const find = (id: string) =>
    db.prepare(`SELECT * FROM "${model.table}" WHERE id = ?`).get(id) as Row | undefined;

  app.get(base, (c) => {
    const user = c.get("user");
    if (!can(user.role, model.table, "list")) return forbidden(c);
    const oc = owner(user.role);
    const rows = (
      oc
        ? db.prepare(`SELECT * FROM "${model.table}" WHERE "${oc}" = ? ORDER BY created_at, id`).all(user.username)
        : db.prepare(`SELECT * FROM "${model.table}" ORDER BY created_at, id`).all()
    ) as Row[];
    return c.json(rows.map((r) => strip(model, user.role, r)));
  });

  app.get(`${base}/:id`, (c) => {
    const user = c.get("user");
    if (!can(user.role, model.table, "read")) return forbidden(c);
    const row = find(c.req.param("id"));
    const oc = owner(user.role);
    if (!row || (oc && row[oc] !== user.username)) return c.json({ error: "not found" }, 404);
    return c.json(strip(model, user.role, row));
  });

  app.post(base, async (c) => {
    const user = c.get("user");
    if (!can(user.role, model.table, "create")) return forbidden(c);
    const body = (await c.req.json().catch(() => ({}))) as Row;
    const oc = owner(user.role);
    if (oc) body[oc] = user.username; // rows created under a row-level rule belong to the creator
    if (model.workflow) body[model.workflow.column] = model.workflow.states[0]; // records start in the first state
    const checked = validate(model, user.role, body, false);
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    const values = checked.values;
    values.id = randomUUID();
    const keys = Object.keys(values);
    try {
      db.prepare(
        `INSERT INTO "${model.table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      ).run(...(keys.map((k) => values[k]) as never[]));
    } catch (e) {
      const dup = String((e as Error).message).includes("UNIQUE");
      return c.json({ error: dup ? "duplicate value" : "could not save" }, 409);
    }
    return c.json(strip(model, user.role, find(values.id as string)!), 201);
  });

  app.patch(`${base}/:id`, async (c) => {
    const user = c.get("user");
    if (!can(user.role, model.table, "update")) return forbidden(c);
    const row = find(c.req.param("id"));
    const oc = owner(user.role);
    if (!row || (oc && row[oc] !== user.username)) return c.json({ error: "not found" }, 404);
    const checked = validate(model, user.role, await c.req.json().catch(() => ({})), true);
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    const values = checked.values;
    if (oc) delete values[oc]; // ownership never changes through an update
    const wf = model.workflow;
    if (wf && wf.column in values && values[wf.column] !== row[wf.column]) {
      if (!canTransition(user.role, model.table, String(row[wf.column]), String(values[wf.column]))) {
        return forbidden(c);
      }
    }
    const keys = Object.keys(values);
    if (keys.length) {
      try {
        db.prepare(`UPDATE "${model.table}" SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`).run(
          ...(keys.map((k) => values[k]) as never[]),
          row.id as string,
        );
      } catch {
        return c.json({ error: "duplicate value" }, 409);
      }
    }
    return c.json(strip(model, user.role, find(row.id as string)!));
  });

  app.delete(`${base}/:id`, (c) => {
    const user = c.get("user");
    if (!can(user.role, model.table, "delete")) return forbidden(c);
    const oc = owner(user.role);
    try {
      const res = oc
        ? db.prepare(`DELETE FROM "${model.table}" WHERE id = ? AND "${oc}" = ?`).run(c.req.param("id"), user.username)
        : db.prepare(`DELETE FROM "${model.table}" WHERE id = ?`).run(c.req.param("id"));
      return Number(res.changes) ? c.body(null, 204) : c.json({ error: "not found" }, 404);
    } catch (e) {
      // The foreign key refuses to orphan records that still point here.
      if (String((e as Error).message).includes("FOREIGN KEY")) {
        return c.json({ error: `${model.label} is still used by other records` }, 409);
      }
      throw e;
    }
  });
}
