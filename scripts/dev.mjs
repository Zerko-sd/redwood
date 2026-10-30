import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";

// One command for everything: the server, restarted when generator code changes, and the Builder.
// PORT, BUILDER_PORT and REDWOOD_DB pass straight through, so a second copy can run beside the first.
if (process.env.PORT) process.env.REDWOOD_PORT ??= process.env.PORT;
const serverPort = Number(process.env.PORT ?? 8800);
const builderPort = Number(process.env.BUILDER_PORT ?? 5180);
const shell = process.platform === "win32";

const inUse = (port) =>
  new Promise((ok) => {
    const s = connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); ok(true); });
    s.once("error", () => ok(false));
  });

// A busy port would leave half of this running against whatever already holds it, so say so and stop.
for (const port of [serverPort, builderPort]) {
  if (await inUse(port)) {
    console.error(`Port ${port} is already in use. Stop what is running there, or set PORT and BUILDER_PORT.`);
    process.exit(1);
  }
}

const stop = (child) => {
  if (child.exitCode !== null) return;
  // On Windows these run through a shell, and killing the shell would leave the servers behind.
  if (shell) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};
const run = (name, command, args) => {
  const child = spawn(command, args, { stdio: "inherit", shell });
  child.on("exit", (code) => { console.log(`${name} stopped (${code})`); stopAll(); });
  return child;
};

const children = [
  run("server", "npx", ["tsx", "watch", "--include", "packages/**/*.tpl", "--include", "packages/generator/templates/**", "apps/server/src/index.ts"]),
  run("builder", "npm", ["run", "dev", "-w", "@redwood/builder"]),
];

function stopAll() {
  children.forEach(stop);
  process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
