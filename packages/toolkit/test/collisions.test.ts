import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { validateRegistryRepo } from "../src/registry-validator.ts";
import { mkTmpRepo } from "./helpers.ts";

async function mkRegistry(files: Record<string, string>): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-collision-registry-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(repo, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }
  return repo;
}

const COLLISION_MANIFEST = JSON.stringify({ version: 1, title: "Corp", description: "Corp registry" }, null, 2);

test("a skill and a prompt-section may share an id (uniqueness is per entity kind)", async () => {
  const repo = await mkRegistry({
    "harness-registry.json": COLLISION_MANIFEST,
    "skills/engineering/deploy/SKILL.md": "# deploy\n\nDeploy skill.\n",
    "prompt-sections/engineering/deploy/SECTION.md":
      "---\nname: deploy\ndescription: Deploy guidance\n---\n\nDeploy rules.\n",
  });

  const result = await validateRegistryRepo({ repoPath: repo });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("two skills sharing an id across categories is a validation error", async () => {
  const repo = await mkRegistry({
    "harness-registry.json": COLLISION_MANIFEST,
    "skills/engineering/deploy/SKILL.md": "# deploy\n\nEngineering deploy.\n",
    "skills/pm/deploy/SKILL.md": "# deploy\n\nPM deploy.\n",
  });

  const result = await validateRegistryRepo({ repoPath: repo });
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "REGISTRY_SKILL_DUPLICATE_ID"));
});

test("apply fails on unmanaged output collision", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPromptSection("system");
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, "AGENTS.md"), "manual\n", "utf8");

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_COLLISION_UNMANAGED"));
});

test("apply fails when different providers target the same output path", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPromptSection("system");
  await engine.enableProvider("codex");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/prompt-sections/system/OVERRIDES.codex.yaml"),
    "version: 1\ntargetPath: shared/AGENTS.md\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompt-sections/system/OVERRIDES.claude.yaml"),
    "version: 1\ntargetPath: shared/AGENTS.md\n",
    "utf8",
  );

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_PATH_COLLISION"));
  assert.equal(result.writtenArtifacts.length, 0);
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
    JSON.stringify(
      {
        servers: {
          shared: {
            command: "node",
            args: ["a"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/two.json"),
    JSON.stringify(
      {
        servers: {
          shared: {
            command: "node",
            args: ["b"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "MCP_RENDER_FAILED"));
});
