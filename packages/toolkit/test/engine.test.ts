import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-test-"));
}

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
    ["prompt:system", "skill:reviewer", "mcp_config:playwright"]
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/mcp/playwright.json")));
});

test("validate fails when unmanaged source candidate exists", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  await fs.writeFile(path.join(cwd, ".harness/src/mcp/manual.json"), "{}\n", "utf8");

  const validation = await engine.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_UNREGISTERED"));
});

test("provider enablement controls generated outputs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");
  await engine.enableProvider("codex");

  const apply = await engine.apply();
  assert.equal(apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, "AGENTS.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/config.toml")));

  await assert.rejects(async () => fs.stat(path.join(cwd, "CLAUDE.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".github/copilot-instructions.md")));
});

test("manifest.lock remains byte-stable on no-op apply", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  const first = await engine.apply();
  assert.equal(first.diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const lockBefore = await fs.readFile(lockPath, "utf8");

  const second = await engine.apply();
  assert.equal(second.diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

  const lockAfter = await fs.readFile(lockPath, "utf8");
  assert.equal(lockAfter, lockBefore);
});

test("apply fails on unmanaged output collision", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, "AGENTS.md"), "manual\n", "utf8");

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_COLLISION_UNMANAGED"));
});

test("MCP conflict on duplicate server IDs with different values", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("codex");
  await engine.addMcp("one");
  await engine.addMcp("two");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/one.json"),
    JSON.stringify({
      servers: {
        shared: {
          command: "node",
          args: ["a"]
        }
      }
    }, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/two.json"),
    JSON.stringify({
      servers: {
        shared: {
          command: "node",
          args: ["b"]
        }
      }
    }, null, 2),
    "utf8"
  );

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "MCP_RENDER_FAILED"));
});
