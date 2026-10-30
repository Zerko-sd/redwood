import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Builder talks only to the Redwood server. Proxying keeps the session cookie same-origin.
const server = `http://127.0.0.1:${process.env.REDWOOD_PORT ?? 8800}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1", // the preview iframe is served from 127.0.0.1; the same host keeps its session cookie first-party
    port: Number(process.env.BUILDER_PORT ?? 5180),
    proxy: { "/api": server, "/ws": { target: server, ws: true } },
  },
});
