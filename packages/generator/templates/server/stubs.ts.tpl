import type { Hono } from "hono";
import type { Env } from "./crud";
import { can } from "../shared/policy";

/**
 * Custom actions the spec names but Redwood has no template for. They answer 501
 * until a developer implements them in custom/routes.ts (registered first, so it wins).
 */
const STUBS: { table: string; action: string }[] = __STUBS__;

export function mountStubs(app: Hono<Env>): void {
  for (const { table, action } of STUBS) {
    app.post(`/api/${table}/:id/${action}`, (c) => {
      if (!can(c.get("user").role, table, "update")) return c.json({ error: "forbidden" }, 403);
      return c.json({ error: `not implemented: ${table}/${action} needs a developer` }, 501);
    });
  }
}
