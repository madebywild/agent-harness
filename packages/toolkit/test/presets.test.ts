import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import * as TOML from "@iarna/toml";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

test("listPresets returns bundled presets before workspace initialization", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  const presets = await engine.listPresets();
  assert.ok(presets.some((preset) => preset.id === "delegate" && preset.source === "builtin"));
  assert.ok(presets.some((preset) => preset.id === "starter" && preset.source === "builtin"));
  assert.ok(presets.some((preset) => preset.id === "researcher" && preset.source === "builtin"));
  assert.ok(presets.some((preset) => preset.id === "yolo" && preset.source === "builtin"));
});

test("applyPreset materializes delegated init preset with a shared bootstrap prompt", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  const result = await engine.applyPreset("delegate");

  assert.equal(result.preset.id, "delegate");
  assert.ok(result.results.some((entry) => entry.type === "enable_provider" && entry.target === "claude"));
  assert.ok(result.results.some((entry) => entry.type === "enable_provider" && entry.target === "codex"));
  assert.ok(result.results.some((entry) => entry.type === "enable_provider" && entry.target === "copilot"));
  assert.ok(result.results.some((entry) => entry.type === "add_prompt" && entry.outcome === "applied"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
    entities: Array<{ type: string; id: string }>;
  };

  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
  assert.ok(manifest.entities.some((entity) => entity.type === "prompt" && entity.id === "system"));

  const prompt = await fs.readFile(path.join(cwd, ".harness/src/prompts/system.md"), "utf8");
  assert.match(prompt, /This is a temporary bootstrap prompt for agent-harness\./u);
  assert.match(prompt, /pnpm harness <command>/u);
  assert.match(prompt, /npx harness <command>/u);
  assert.match(
    prompt,
    /Do not edit generated files like `CLAUDE\.md`, `AGENTS\.md`, or `\.github\/copilot-instructions\.md` directly\./u,
  );
});

test("applyPreset materializes bundled preset content and enables providers", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  const result = await engine.applyPreset("starter");

  assert.equal(result.preset.id, "starter");
  assert.ok(result.results.some((entry) => entry.type === "enable_provider" && entry.outcome === "applied"));
  assert.ok(result.results.some((entry) => entry.type === "add_prompt" && entry.outcome === "applied"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
    entities: Array<{ type: string; id: string }>;
  };

  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
  assert.ok(manifest.entities.some((entity) => entity.type === "prompt" && entity.id === "system"));
  assert.ok(manifest.entities.some((entity) => entity.type === "skill" && entity.id === "reviewer"));
  assert.ok(manifest.entities.some((entity) => entity.type === "command" && entity.id === "fix-issue"));

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands/fix-issue.md")));
});

test("applyPreset materializes yolo preset with settings for all providers", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  const result = await engine.applyPreset("yolo");

  assert.equal(result.preset.id, "yolo");
  assert.ok(result.results.some((entry) => entry.type === "add_prompt" && entry.outcome === "applied"));
  assert.ok(result.results.some((entry) => entry.type === "add_settings" && entry.target === "settings:claude"));
  assert.ok(result.results.some((entry) => entry.type === "add_settings" && entry.target === "settings:codex"));
  assert.ok(result.results.some((entry) => entry.type === "add_settings" && entry.target === "settings:copilot"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
    entities: Array<{ type: string; id: string }>;
  };

  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
  assert.ok(manifest.entities.some((entity) => entity.type === "settings" && entity.id === "claude"));
  assert.ok(manifest.entities.some((entity) => entity.type === "settings" && entity.id === "codex"));
  assert.ok(manifest.entities.some((entity) => entity.type === "settings" && entity.id === "copilot"));

  const claudeSettings = JSON.parse(
    await fs.readFile(path.join(cwd, ".harness/src/settings/claude.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.deepEqual(
    (claudeSettings as { permissions: { defaultMode: string } }).permissions.defaultMode,
    "bypassPermissions",
  );

  const codexSettings = TOML.parse(
    await fs.readFile(path.join(cwd, ".harness/src/settings/codex.toml"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(codexSettings.approval_policy, "never");
  assert.equal(codexSettings.sandbox_mode, "danger-full-access");

  const copilotSettings = JSON.parse(
    await fs.readFile(path.join(cwd, ".harness/src/settings/copilot.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(copilotSettings["chat.tools.global.autoApprove"], true);
  assert.equal(copilotSettings["chat.autopilot.enabled"], true);
});

test("applyPreset skips when bundled preset content is already present", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.applyPreset("starter");
  const second = await engine.applyPreset("starter");

  assert.ok(second.results.every((entry) => entry.outcome === "skipped"));
});

test("applyPreset skips when delegated preset content is already present", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.applyPreset("delegate");
  const second = await engine.applyPreset("delegate");

  assert.ok(second.results.every((entry) => entry.outcome === "skipped"));
});

test("applyPreset loads local preset packages from .harness/presets", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await fs.mkdir(path.join(cwd, ".harness/presets/local-docs"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(cwd, ".harness/presets/local-docs/preset.json"),
    JSON.stringify(
      {
        id: "local-docs",
        name: "Local Docs Preset",
        description: "Adds a prompt and docs helper command.",
        operations: [{ type: "add_prompt" }, { type: "add_command", id: "update-docs" }],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/presets/local-docs/prompt.md"),
    "# System Prompt\n\nOptimize for documentation maintenance.\n",
    "utf8",
  );
  await fs.mkdir(path.join(cwd, ".harness/presets/local-docs/commands"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(cwd, ".harness/presets/local-docs/commands/update-docs.md"),
    '---\ndescription: "Update relevant docs"\n---\n\n# update-docs\n\nRefresh any docs affected by the change.\n',
    "utf8",
  );

  const result = await engine.applyPreset("local-docs");
  assert.equal(result.preset.source, "local");
  assert.ok(result.results.some((entry) => entry.target === "command:update-docs" && entry.outcome === "applied"));
});
