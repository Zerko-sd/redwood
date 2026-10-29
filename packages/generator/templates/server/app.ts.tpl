import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { login, logout, userForToken } from "./auth";
import { mountCrud, type Env } from "./crud";
import { models } from "../shared/model";
import { customRoutes } from "../../custom/routes";
import { mountStubs } from "./stubs";

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();

  app.post("/api/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
    const session = login(String(body.username ?? ""), String(body.password ?? ""));
    if (!session) return c.json({ error: "invalid credentials" }, 401);
    setCookie(c, "sid", session.token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 12 * 3600 });
    return c.json(session.user);
  });

  app.post("/api/logout", (c) => {
    logout(getCookie(c, "sid"));
    deleteCookie(c, "sid", { path: "/" });
    return c.body(null, 204);
  });

  // Everything below requires a signed-in user.
  app.use("/api/*", async (c, next) => {
    const user = userForToken(getCookie(c, "sid"));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/api/me", (c) => c.json(c.get("user")));

  for (const model of Object.values(models)) mountCrud(app, model);
  customRoutes(app); // registered before the stubs, so a developer's route wins
  mountStubs(app);
  return app;
}
