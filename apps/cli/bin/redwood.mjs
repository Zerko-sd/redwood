#!/usr/bin/env node
// Runs the TypeScript sources directly, so there is no build step to forget.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/index.ts");
process.exitCode = await main(process.argv.slice(2));
