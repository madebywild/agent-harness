import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

const execFileAsync = promisify(execFile);

async function readJson<T>(cwd: string, relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(cwd, relativePath), "utf8");
  return JSON.parse(text) as T;
}

async function writeJson(cwd: string, relativePath: string, value: unknown): Promise<void> {
  await fs.writeFile(path.join(cwd, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("doctor reports a healthy current workspace", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  const doctor = await engine.doctor();
  assert.equal(doctor.healthy, true);
  assert.equal(doctor.diagnostics.length, 0);
  assert.ok(doctor.files.some((file) => file.code === "MANIFEST_VERSION_CURRENT"));
});

test("doctor surfaces outdated override sidecars with provider context", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.overrides.codex.yaml"),
    "version: 0\nenabled: true\n",
    "utf8",
  );

  const doctor = await engine.doctor();
  const override = doctor.files.find((file) => file.path === ".harness/src/prompts/system.overrides.codex.yaml");

  assert.ok(override);
  assert.equal(override?.provider, "codex");
  assert.equal(override?.status, "outdated");
  assert.equal(override?.code, "OVERRIDE_VERSION_OUTDATED");
});

test("non-current workspace blocks plan/apply/validate and mutating commands", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 0;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const plan = await engine.plan();
  assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.code === "MANIFEST_VERSION_OUTDATED"));

  const validation = await engine.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "MANIFEST_VERSION_OUTDATED"));

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "MANIFEST_VERSION_OUTDATED"));
  assert.equal(apply.writtenArtifacts.length, 0);

  await assert.rejects(async () => engine.addSkill("blocked"), /MANIFEST_VERSION_OUTDATED/u);
});

test("doctor flags mixed-version state as migration incomplete", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 0;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const doctor = await engine.doctor();
  assert.ok(doctor.diagnostics.some((diagnostic) => diagnostic.code === "MIGRATION_INCOMPLETE"));
});

test("migrate --dry-run reports actions without writing files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 0;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const beforeManifest = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");

  const migrated = await engine.migrate({ to: "latest", dryRun: true });
  assert.equal(migrated.success, true);
  assert.ok(migrated.actions.some((action) => action.action === "rewrite" || action.action === "migrate"));

  const afterManifest = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  assert.equal(afterManifest, beforeManifest);
});

test("migrate creates backups and upgrades outdated manifest", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 0;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const migrated = await engine.migrate({ to: "latest" });
  assert.equal(migrated.success, true);
  assert.ok(migrated.backupRoot);

  const manifestAfter = await readJson<{ version: number }>(cwd, ".harness/manifest.json");
  assert.equal(manifestAfter.version, 1);

  const backupManifest = await readJson<{ version: number }>(
    "/",
    path.join(migrated.backupRoot as string, ".harness/manifest.json"),
  );
  assert.equal(backupManifest.version, 0);
});

test("migrate rebuilds managed-index to adopt desired output paths", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  const applied = await engine.apply();
  assert.equal(
    applied.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 0;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const lock = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.lock.json");
  lock.version = 0;
  await writeJson(cwd, ".harness/manifest.lock.json", lock);

  await writeJson(cwd, ".harness/managed-index.json", {
    version: 0,
    managedSourcePaths: [],
    managedOutputPaths: [],
  });

  const migrated = await engine.migrate({ to: "latest" });
  assert.equal(migrated.success, true);

  const managedIndex = await readJson<{ version: number; managedOutputPaths: string[] }>(
    cwd,
    ".harness/managed-index.json",
  );
  assert.equal(managedIndex.version, 1);
  assert.ok(managedIndex.managedOutputPaths.includes("AGENTS.md"));

  const applyAfter = await engine.apply();
  assert.equal(
    applyAfter.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_COLLISION_UNMANAGED"),
    false,
  );
});

test("migrate refuses to downgrade newer workspace files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 2;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const before = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");

  const migrated = await engine.migrate({ to: "latest" });
  assert.equal(migrated.success, false);
  assert.ok(migrated.diagnostics.some((diagnostic) => diagnostic.code === "MIGRATION_DOWNGRADE_UNSUPPORTED"));

  const after = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  assert.equal(after, before);
});

test("init --force does not mutate newer workspace schemas", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  const manifest = await readJson<Record<string, unknown>>(cwd, ".harness/manifest.json");
  manifest.version = 2;
  await writeJson(cwd, ".harness/manifest.json", manifest);

  const before = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");

  await assert.rejects(async () => engine.init({ force: true }), /MANIFEST_VERSION_NEWER_THAN_CLI/u);

  const after = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  assert.equal(after, before);
});

test("default CLI command reports missing workspace before version diagnostics", async () => {
  const cwd = await mkTmpRepo();

  await assert.rejects(
    async () =>
      execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", "--cwd", cwd], {
        cwd: process.cwd(),
      }),
    (error) => {
      if (!error || typeof error !== "object") {
        return false;
      }

      const stdout = "stdout" in error ? String(error.stdout ?? "") : "";
      assert.match(stdout, /WORKSPACE_NOT_INITIALIZED/u);
      assert.match(stdout, /harness init/u);
      assert.doesNotMatch(stdout, /WORKSPACE_VERSION_BLOCKED/u);
      return true;
    },
  );
});

test("cli --version prints package version", async () => {
  const packageJson = await readJson<{ version: string }>(process.cwd(), "package.json");
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", "--version"], {
    cwd: process.cwd(),
  });

  assert.equal(stdout.trim(), packageJson.version);
});
