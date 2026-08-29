import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

const MAP_YAML = [
  "version: 1",
  "keys:",
  "  effort:",
  "    description: How much validation to run per iteration",
  "    default: thorough",
  "    values:",
  "      fast: |",
  "        Skip broad tests and linting until a merge is requested.",
  "      thorough: |",
  "        Run the full test and lint suite after every change.",
  "",
].join("\n");

async function setupWorkspace(): Promise<{ cwd: string; engine: HarnessEngine }> {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addPromptSection("system");
  await engine.enableProvider("claude");
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md"),
    "Follow this effort policy:\n\n{{behavior.effort}}\n",
  );
  return { cwd, engine };
}

test("behavior integration: map default fills the placeholder in provider output", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);

  const result = await engine.apply();
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `unexpected errors: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);

  const output = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(output.includes("Run the full test and lint suite"), "Output should contain the default instruction");
  assert.ok(!output.includes("{{behavior."), "Output should not contain raw behavior placeholders");
});

test("behavior integration: config choice switches rendered output without changing the lock SHA", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);

  await engine.apply();
  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const lock1 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ type: string; sourceSha256: string }>;
  };
  const sha1 = lock1.entities.find((e) => e.type === "prompt_section")?.sourceSha256;
  assert.ok(sha1);

  await engine.behaviorSet("effort", "fast");

  const plan = await engine.plan();
  assert.ok(
    plan.operations.some((operation) => operation.type === "update" && operation.path === "CLAUDE.md"),
    "Changing the behavior value should plan an update for CLAUDE.md",
  );

  const result = await engine.apply();
  assert.equal(result.diagnostics.filter((d) => d.severity === "error").length, 0);

  const output = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(output.includes("Skip broad tests and linting"), "Output should contain the configured instruction");

  const lock2 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ type: string; sourceSha256: string }>;
  };
  const sha2 = lock2.entities.find((e) => e.type === "prompt_section")?.sourceSha256;
  assert.equal(sha1, sha2, "sourceSha256 must stay on raw pre-substitution text");
});

test("behavior integration: unresolved placeholder is a warning and stays literal", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md"), "Policy: {{behavior.effort}}\n");
  // No behavior map at all.

  const validation = await engine.validate();
  assert.equal(validation.valid, true, "Unresolved behavior placeholder must not fail validation");
  const warning = validation.diagnostics.find((d) => d.code === "BEHAVIOR_PLACEHOLDER_UNRESOLVED");
  assert.ok(warning, "Should emit BEHAVIOR_PLACEHOLDER_UNRESOLVED");
  assert.equal(warning.severity, "warning");
  assert.equal(warning.entityId, "system");

  await engine.apply();
  const output = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(output.includes("{{behavior.effort}}"), "Unresolved placeholder should remain literal in output");
});

test("behavior integration: config errors block apply", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);
  await fs.writeFile(path.join(cwd, ".harness/behavior.yaml"), "speed: fast\n");

  const validation = await engine.validate();
  assert.equal(validation.valid, false);
  assert.ok(validation.diagnostics.some((d) => d.code === "BEHAVIOR_KEY_UNKNOWN"));

  const result = await engine.apply();
  assert.equal(result.writtenArtifacts.length, 0, "apply must refuse to write with behavior errors");

  await fs.writeFile(path.join(cwd, ".harness/behavior.yaml"), "effort: turbo\n");
  const validation2 = await engine.validate();
  assert.ok(validation2.diagnostics.some((d) => d.code === "BEHAVIOR_VALUE_INVALID"));

  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), "");
  await fs.rm(path.join(cwd, ".harness/behavior.map.yaml"));
  await fs.writeFile(path.join(cwd, ".harness/behavior.yaml"), "effort: fast\n");
  const validation3 = await engine.validate();
  assert.ok(validation3.diagnostics.some((d) => d.code === "BEHAVIOR_MAP_MISSING"));
});

test("behavior integration: unresolved behavior placeholder in JSON entity stays parseable", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addMcp("myserver");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/myserver.json"),
    '{\n  "servers": {\n    "myserver": {\n      "command": "node",\n      "args": ["server.js"],\n      "note": {{behavior.effort}}\n    }\n  }\n}\n',
  );

  const result = await engine.apply();
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `unexpected errors: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
  assert.ok(result.diagnostics.some((d) => d.code === "BEHAVIOR_PLACEHOLDER_UNRESOLVED"));

  const mcpOutput = await fs.readFile(path.join(cwd, ".mcp.json"), "utf8");
  assert.ok(
    mcpOutput.includes('"{{behavior.effort}}"'),
    "MCP output should preserve unresolved bare behavior placeholders as string values",
  );
});

test("behavior integration: resolved behavior value substitutes inside JSON entity", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addMcp("myserver");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/behavior.map.yaml"),
    "version: 1\nkeys:\n  mode:\n    default: quick\n    values:\n      quick: single-line-mode\n",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/myserver.json"),
    JSON.stringify(
      { servers: { myserver: { command: "node", args: ["server.js"], env: { MODE: "{{behavior.mode}}" } } } },
      null,
      2,
    ),
  );

  const result = await engine.apply();
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `unexpected errors: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);

  const mcpOutput = await fs.readFile(path.join(cwd, ".mcp.json"), "utf8");
  assert.ok(mcpOutput.includes("single-line-mode"));
  assert.ok(!mcpOutput.includes("{{behavior.mode}}"));
});

test("behavior integration: behaviorSet validates and preserves config comments", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);
  await fs.writeFile(path.join(cwd, ".harness/behavior.yaml"), "# my local choices\neffort: thorough\n");

  await engine.behaviorSet("effort", "fast");
  const config = await fs.readFile(path.join(cwd, ".harness/behavior.yaml"), "utf8");
  assert.ok(config.includes("# my local choices"), "behaviorSet should preserve comments");
  assert.ok(config.includes("effort: fast"));

  await assert.rejects(() => engine.behaviorSet("effort", "turbo"), /Allowed values: fast, thorough/);
  await assert.rejects(() => engine.behaviorSet("speed", "fast"), /Known keys: effort/);
});

test("behavior integration: init ships .harness/.gitignore covering local-only files", async () => {
  const cwd = await mkTmpRepo();
  await new HarnessEngine(cwd).init();

  const ignore = await fs.readFile(path.join(cwd, ".harness/.gitignore"), "utf8");
  assert.ok(ignore.includes("behavior.yaml"), "should ignore the per-developer behavior config");
  assert.ok(ignore.includes(".env"), "should ignore harness secrets");
});

test("behavior integration: behaviorSet backfills .gitignore but never clobbers an existing one", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);

  // Simulate a workspace created before .harness/.gitignore existed.
  await fs.rm(path.join(cwd, ".harness/.gitignore"));
  await engine.behaviorSet("effort", "fast");
  const backfilled = await fs.readFile(path.join(cwd, ".harness/.gitignore"), "utf8");
  assert.ok(backfilled.includes("behavior.yaml"));

  // A project-owned .gitignore is left exactly as-is.
  await fs.writeFile(path.join(cwd, ".harness/.gitignore"), "# hand written\nbehavior.yaml\n");
  await engine.behaviorSet("effort", "thorough");
  const preserved = await fs.readFile(path.join(cwd, ".harness/.gitignore"), "utf8");
  assert.equal(preserved, "# hand written\nbehavior.yaml\n");
});

test("behavior integration: behaviorShow reports value, source, and allowed values", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);

  const before = await engine.behaviorShow();
  assert.equal(before.choices.get("effort")?.source, "default");
  assert.equal(before.choices.get("effort")?.value, "thorough");

  await engine.behaviorSet("effort", "fast");
  const after = await engine.behaviorShow();
  assert.equal(after.choices.get("effort")?.source, "config");
  assert.equal(after.choices.get("effort")?.value, "fast");
  assert.deepEqual(after.choices.get("effort")?.allowed, ["fast", "thorough"]);
});

test("behavior integration: doctor inspects the behavior map version", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);

  const healthy = await engine.doctor();
  const mapStatus = healthy.files.find((file) => file.kind === "behavior-map");
  assert.ok(mapStatus, "doctor should inspect the behavior map");
  assert.equal(mapStatus.status, "current");

  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), "version: 2\nkeys: {}\n");
  const blocked = await engine.doctor();
  const newer = blocked.files.find((file) => file.kind === "behavior-map");
  assert.equal(newer?.status, "unsupported");
  assert.equal(newer?.code, "BEHAVIOR_MAP_VERSION_NEWER_THAN_CLI");
});

test("behavior integration: doctor skips an absent behavior map", async () => {
  const { engine } = await setupWorkspace();
  const result = await engine.doctor();
  assert.ok(!result.files.some((file) => file.kind === "behavior-map"));
});

test("behavior integration: env pass and behavior pass compose in one source", async () => {
  const { cwd, engine } = await setupWorkspace();
  await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), MAP_YAML);
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md"),
    "Project {{PROJECT_NAME}} policy:\n\n{{behavior.effort}}\n",
  );
  await fs.writeFile(path.join(cwd, ".harness/.env"), "PROJECT_NAME=Acme\n");

  const result = await engine.apply();
  assert.equal(result.diagnostics.filter((d) => d.severity === "error").length, 0);

  const output = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(output.includes("Acme"));
  assert.ok(output.includes("Run the full test and lint suite"));
});
