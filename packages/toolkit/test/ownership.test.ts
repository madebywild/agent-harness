import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

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

test("validate fails when unmanaged override sidecar exists", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  await fs.writeFile(path.join(cwd, ".harness/src/mcp/manual.overrides.codex.yaml"), "version: 1\n", "utf8");

  const validation = await engine.validate();
  assert.equal(validation.valid, false);
  assert.ok(
    validation.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "SOURCE_UNREGISTERED" && diagnostic.path === ".harness/src/mcp/manual.overrides.codex.yaml",
    ),
  );
});
