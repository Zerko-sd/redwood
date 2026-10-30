import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Every workspace has its own tsconfig; none of them is a project reference of the root.
const tsc = join("node_modules", "typescript", "bin", "tsc");
const dirs = ["packages", "apps"].flatMap((d) => readdirSync(d).map((n) => join(d, n)));
let failed = 0;
for (const dir of dirs) {
  const r = spawnSync(process.execPath, [tsc, "--noEmit", "--composite", "false", "--declaration", "false", "-p", dir], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
