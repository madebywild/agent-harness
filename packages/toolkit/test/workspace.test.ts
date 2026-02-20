import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

test("init + add commands scaffold manifest and source files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ id: string; type: string }>;
  };

  assert.equal(manifest.entities.length, 3);
  assert.deepEqual(
    manifest.entities.map((entity) => `${entity.type}:${entity.id}`),
    ["prompt:system", "skill:reviewer", "mcp_config:playwright"],
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/mcp/playwright.json")));
});

test("init fails when .harness already exists without force", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  await assert.rejects(async () => engine.init(), /already exists/);
});

test("init --force recreates .harness workspace", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  await engine.init({ force: true });

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ id: string; type: string }>;
  };
  assert.deepEqual(manifest.entities, []);
  await assert.rejects(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
});

test("manifest.lock remains byte-stable on no-op apply", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  const first = await engine.apply();
  assert.equal(
    first.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const lockBefore = await fs.readFile(lockPath, "utf8");

  const second = await engine.apply();
  assert.equal(
    second.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const lockAfter = await fs.readFile(lockPath, "utf8");
  assert.equal(lockAfter, lockBefore);
});
