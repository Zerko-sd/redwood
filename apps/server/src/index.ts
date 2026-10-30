import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { createApp, type PreviewLike } from "./app";
import { openDb, type Db } from "./db";
import { llmConfigFromEnv, openAiCompatible, withCache, type LlmClient } from "@redwood/suggest";
import { Hub } from "./hub";
import { PreviewManager } from "./preview";

export interface Running {
  port: number;
  db: Db;
  hub: Hub;
  close(): Promise<void>;
}

/** Starts the Redwood API and its WebSocket on one port. Loopback only unless HOST says otherwise. */
export async function startServer(opts: { port?: number; dbPath?: string; previewRoot?: string; preview?: PreviewLike; llm?: LlmClient | null } = {}): Promise<Running> {
  const db = openDb(opts.dbPath);
  const hub = new Hub();
  const manager = opts.preview ? undefined : new PreviewManager({
    root: resolve(opts.previewRoot ?? process.env.REDWOOD_PREVIEW_ROOT ?? ".preview"),
    onChange: (id, s) => hub.broadcast(id, { type: "preview", state: s.state }),
  });
  const preview = opts.preview ?? manager!;
  // A model is optional: without a key the Builder still works and just offers no suggestions.
  const cfg = opts.llm === undefined ? llmConfigFromEnv() : null;
  const llm = opts.llm !== undefined ? opts.llm : cfg ? withCache(openAiCompatible(cfg)) : null;
  const app = createApp({ db, hub, preview, llm });
  const hostname = process.env.HOST ?? "127.0.0.1";
  const server = await new Promise<Server>((ok) => {
    const s = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname }, () => ok(s as Server));
  });
  const sockets = hub.attach(server, db);
  const port = (server.address() as { port: number }).port;
  return {
    port, db, hub,
    close: async () => {
      sockets.close();
      manager?.stopAll();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

export * from "./app";
export * from "./store";
export * from "./perms";
export { PreviewManager } from "./preview";

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  // Keys live in .env (git-ignored). Missing file is fine; the environment can supply them instead.
  try { process.loadEnvFile(".env"); } catch { /* no .env */ }
  const port = Number(process.env.PORT ?? 8800);
  startServer({ port }).then((s) => {
    console.log(`redwood server on http://127.0.0.1:${s.port}`);
    const stop = () => void s.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
