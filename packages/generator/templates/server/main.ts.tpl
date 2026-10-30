import { serve } from "@hono/node-server";
import { migrate } from "./db";
import { seedDemo } from "./seed";
import { createApp } from "./app";

const ran = migrate();
if (ran.length) console.log(`applied migrations: ${ran.join(", ")}`);
// `--seed` (or SEED_DEMO=1) creates one demo user per role and the spec's sample rows.
if (process.argv.includes("--seed") || process.env.SEED_DEMO === "1") seedDemo(process.env.SEED_REPLACE === "1");

const port = Number(process.env.PORT ?? 8787);
// Loopback only unless HOST says otherwise: demo accounts must never be reachable from the network by accident.
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: createApp().fetch, port, hostname });
console.log(`api listening on http://${hostname}:${port}`);
