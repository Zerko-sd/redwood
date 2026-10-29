import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src";

let cwd: string;
beforeEach(() => void (cwd = mkdtempSync(join(tmpdir(), "redwood-cli-"))));
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), cwd });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("redwood cli", () => {
  it("prints help, and exits 2 on bad usage", async () => {
    expect((await run("--help")).code).toBe(0);
    expect((await run()).code).toBe(2);
    expect((await run("nonsense")).code).toBe(2);
    expect((await run("generate", "x.json", "--bogus")).code).toBe(2);
    expect((await run("generate", "x.json")).code).toBe(2);
  });

  it("init writes a starter spec and will not overwrite one", async () => {
    const r = await run("init", "Bus Fleet", "--example");
    expect(r.code).toBe(0);
    expect(existsSync(join(cwd, "bus-fleet.spec.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(cwd, "bus-fleet.spec.json"), "utf8")).title).toBe("Bus Fleet");
    expect((await run("init", "Bus Fleet")).code).toBe(1);
  });

  it("check passes a good spec and fails a broken one with readable errors", async () => {
    await run("init", "Fleet", "--example");
    const ok = await run("check", "fleet.spec.json");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("ok: Fleet");

    const spec = JSON.parse(readFileSync(join(cwd, "fleet.spec.json"), "utf8"));
    spec.stories[0].role = "role:ghost";
    writeFileSync(join(cwd, "bad.spec.json"), JSON.stringify(spec));
    const bad = await run("check", "bad.spec.json");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("unknown role role:ghost");

    writeFileSync(join(cwd, "broken.json"), "{ nope");
    expect((await run("check", "broken.json")).err).toContain("not valid JSON");
    expect((await run("check", "missing.json")).code).toBe(1);
  });

  it("plan explains each screen and cites stories", async () => {
    await run("init", "Fleet", "--example");
    const r = await run("plan", "fleet.spec.json");
    expect(r.code).toBe(0);
    expect(r.out).toContain("screen:trips");
    expect(r.out).toContain("StateButtons");
    expect(r.out).toContain("<- story:manage-buses");
    expect(r.out).toContain("dropped  StatCards");
  });

  it("generate writes an app, is a no-op the second time, and verify agrees", async () => {
    await run("init", "Fleet", "--example");
    const first = await run("generate", "fleet.spec.json", "-o", "app");
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/generated app: \d+ written/);
    expect(existsSync(join(cwd, "app", "src/shared/policy.ts"))).toBe(true);
    expect(existsSync(join(cwd, "app", "custom/routes.ts"))).toBe(true);
    expect((await run("generate", "fleet.spec.json", "-o", "app")).out).toContain("nothing changed");
    expect((await run("verify", "app")).code).toBe(0);
  });

  it("refuses to overwrite hand edits unless forced, and verify names them", async () => {
    await run("init", "Fleet", "--example");
    await run("generate", "fleet.spec.json", "-o", "app");
    writeFileSync(join(cwd, "app", "src/shared/policy.ts"), "// mine\n");

    const v = await run("verify", "app");
    expect(v.code).toBe(1);
    expect(v.err).toContain("src/shared/policy.ts");

    const refused = await run("generate", "fleet.spec.json", "-o", "app");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("edited by hand");
    expect(readFileSync(join(cwd, "app", "src/shared/policy.ts"), "utf8")).toBe("// mine\n");

    expect((await run("generate", "fleet.spec.json", "-o", "app", "--force")).code).toBe(0);
    expect((await run("verify", "app")).code).toBe(0);
  });

  it("holds back data-losing changes until --allow-destructive", async () => {
    await run("init", "Fleet", "--example");
    await run("generate", "fleet.spec.json", "-o", "app");
    const spec = JSON.parse(readFileSync(join(cwd, "fleet.spec.json"), "utf8"));
    spec.entities[0].fields = spec.entities[0].fields.filter((f: { id: string }) => f.id !== "field:capacity");
    spec.entities[0].seed = [{ "field:plate": "KA-01-1234" }];
    writeFileSync(join(cwd, "fleet.spec.json"), JSON.stringify(spec));

    const held = await run("generate", "fleet.spec.json", "-o", "app");
    expect(held.code).toBe(1);
    expect(held.err).toContain("bus.capacity is dropped");
    expect((await run("generate", "fleet.spec.json", "-o", "app", "--allow-destructive")).code).toBe(0);
  });

  it("verify rejects a folder redwood never generated", async () => {
    expect((await run("verify", ".")).code).toBe(1);
  });
});
