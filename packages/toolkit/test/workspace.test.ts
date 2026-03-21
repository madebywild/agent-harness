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
  await engine.addSubagent("review-bot");
  await engine.addHook("guard");
  await engine.addCommand("fix-issue");

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ id: string; type: string }>;
  };

  assert.equal(manifest.entities.length, 6);
  assert.deepEqual(
    manifest.entities.map((entity) => `${entity.type}:${entity.id}`),
    [
      "prompt:system",
      "skill:reviewer",
      "mcp_config:playwright",
      "subagent:review-bot",
      "hook:guard",
      "command:fix-issue",
    ],
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/mcp/playwright.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/subagents/review-bot.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/hooks/guard.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands/fix-issue.md")));
});

test("init fails when .harness already exists without force", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  await assert.rejects(async () => engine.init(), /already exists/);
});

test("init scaffolds commands source directory", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands")));
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

test("remove prompt rejects non-system id and preserves manifest entity", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  await assert.rejects(async () => engine.remove("prompt", "wrong-id", false), /must be 'system'/u);

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ id: string; type: string }>;
  };

  assert.deepEqual(
    manifest.entities.map((entity) => `${entity.type}:${entity.id}`),
    ["prompt:system"],
  );
});

test("remove subagent deletes scaffolded source by default", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("researcher");

  const removed = await engine.remove("subagent", "researcher", true);
  assert.deepEqual(removed, { entityType: "subagent", id: "researcher" });

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ id: string; type: string }>;
  };
  assert.equal(
    manifest.entities.some((entity) => entity.type === "subagent" && entity.id === "researcher"),
    false,
  );
  await assert.rejects(async () => fs.stat(path.join(cwd, ".harness/src/subagents/researcher.md")));
});

test("remove hook deletes scaffolded source by default", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");

  const removed = await engine.remove("hook", "guard", true);
  assert.deepEqual(removed, { entityType: "hook", id: "guard" });
  await assert.rejects(async () => fs.stat(path.join(cwd, ".harness/src/hooks/guard.json")));
});

test("remove returns the actual removed entity id", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  const removed = await engine.remove("prompt", "system", false);
  assert.deepEqual(removed, { entityType: "prompt", id: "system" });
});

test("validate reports subagent frontmatter/body requirements", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("invalid-subagent");
  await fs.writeFile(path.join(cwd, ".harness/src/subagents/invalid-subagent.md"), "---\nname: \n---\n\n", "utf8");

  const validation = await engine.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SUBAGENT_NAME_REQUIRED"));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SUBAGENT_DESCRIPTION_REQUIRED"));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SUBAGENT_EMPTY"));
});
