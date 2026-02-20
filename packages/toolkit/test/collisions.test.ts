import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

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

test("apply fails when different providers target the same output path", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.overrides.codex.yaml"),
    "version: 1\ntargetPath: shared/AGENTS.md\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.overrides.claude.yaml"),
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
