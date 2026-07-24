import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import * as TOML from "@iarna/toml";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

const execFileAsync = promisify(execFile);

async function mkTmpGitRegistry(files: Record<string, string>): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-preset-registry-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(repo, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }
  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: repo }).catch(() => {});
  await execFileAsync("git", ["config", "user.name", "Harness Test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "harness-test@example.com"], { cwd: repo });
  await execFileAsync("git", ["add", "."], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repo });
  return repo;
}

const REGISTRY_MANIFEST = JSON.stringify({ version: 1, title: "Corp", description: "Corp registry" }, null, 2);

// A base preset with embedded skills + prompt-sections + an embedded mcp, and a child that extends it.
// Mirrors the registry's example-preset / example-preset-extended contract.
const EXTENDS_REGISTRY_FILES: Record<string, string> = {
  "harness-registry.json": REGISTRY_MANIFEST,
  "presets/base/preset.json": JSON.stringify(
    {
      id: "base",
      name: "Base",
      description: "Base preset with inheritable skills and prompt-sections plus a non-inherited mcp.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "add_prompt_section", id: "root-a" },
        { type: "add_prompt_section", id: "shared-section" },
        { type: "add_skill", id: "skill-a" },
        { type: "add_skill", id: "shared-skill" },
        { type: "add_mcp", id: "base-mcp" },
      ],
    },
    null,
    2,
  ),
  "presets/base/prompt-sections/root-a/SECTION.md": "---\nname: root-a\ndescription: A\n---\n\nRoot A body.\n",
  "presets/base/prompt-sections/shared-section/SECTION.md":
    "---\nname: shared-section\ndescription: S\n---\n\nShared section body.\n",
  "presets/base/skills/skill-a/SKILL.md": "# skill-a\n\nParent skill A.\n",
  "presets/base/skills/shared-skill/SKILL.md": "# shared-skill\n\nPARENT version.\n",
  "presets/base/mcp/base-mcp.json": JSON.stringify({ mcpServers: { base: { command: "base" } } }, null, 2),
  "presets/child/preset.json": JSON.stringify(
    {
      id: "child",
      name: "Child",
      extends: "base",
      description: "Extends base; redefines shared-skill and adds its own section/skill/settings.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "add_prompt_section", id: "child-b" },
        { type: "add_skill", id: "skill-b" },
        { type: "add_skill", id: "shared-skill" },
        { type: "add_settings", provider: "claude" },
      ],
    },
    null,
    2,
  ),
  "presets/child/prompt-sections/child-b/SECTION.md": "---\nname: child-b\ndescription: B\n---\n\nChild B body.\n",
  "presets/child/skills/skill-b/SKILL.md": "# skill-b\n\nChild skill B.\n",
  "presets/child/skills/shared-skill/SKILL.md": "# shared-skill\n\nCHILD version.\n",
  "presets/child/settings/claude.json": JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2),
};

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
  assert.ok(result.results.some((entry) => entry.type === "add_prompt_section" && entry.outcome === "applied"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
    entities: Array<{ type: string; id: string }>;
  };

  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
  assert.ok(manifest.entities.some((entity) => entity.type === "prompt_section" && entity.id === "system"));

  const prompt = await fs.readFile(path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md"), "utf8");
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
  assert.ok(result.results.some((entry) => entry.type === "add_prompt_section" && entry.outcome === "applied"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
    entities: Array<{ type: string; id: string }>;
  };

  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
  assert.ok(manifest.entities.some((entity) => entity.type === "prompt_section" && entity.id === "system"));
  assert.ok(manifest.entities.some((entity) => entity.type === "skill" && entity.id === "reviewer"));
  assert.ok(manifest.entities.some((entity) => entity.type === "command" && entity.id === "fix-issue"));

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands/fix-issue.md")));
});

test("applyPreset materializes yolo preset with settings for all providers", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  const result = await engine.applyPreset("yolo");

  assert.equal(result.preset.id, "yolo");
  assert.ok(result.results.some((entry) => entry.type === "add_prompt_section" && entry.outcome === "applied"));
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
        description: "Adds a prompt-section and docs helper command.",
        operations: [
          { type: "add_prompt_section", id: "system" },
          { type: "add_command", id: "update-docs" },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.mkdir(path.join(cwd, ".harness/presets/local-docs/prompt-sections/system"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(cwd, ".harness/presets/local-docs/prompt-sections/system/SECTION.md"),
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

test("applyPreset resolves extends: inherits skills + prompt-sections parent-first, dedupes, excludes non-inheritable", async () => {
  const registryRepo = await mkTmpGitRegistry(EXTENDS_REGISTRY_FILES);
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await engine.applyPreset("child", { registry: "corp" });

  const manifest = await readJson<{
    entities: Array<{ id: string; type: string; order?: number }>;
  }>(cwd, ".harness/manifest.json");

  // Prompt-sections: inherited (parent-first) then child's own, in composition order.
  const sections = manifest.entities
    .filter((entry) => entry.type === "prompt_section")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((entry) => entry.id);
  assert.deepEqual(sections, ["root-a", "shared-section", "child-b"]);

  // Skills: parent's skill-a + child's skill-b + the shared skill exactly once (child wins).
  const skills = manifest.entities
    .filter((entry) => entry.type === "skill")
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(skills, ["shared-skill", "skill-a", "skill-b"]);

  // Nearest-wins: the shared skill resolves to the child's embedded content.
  const sharedSkill = await fs.readFile(path.join(cwd, ".harness/src/skills/shared-skill/SKILL.md"), "utf8");
  assert.match(sharedSkill, /CHILD version/u);

  // Non-inheritable parent ops are NOT inherited (base-mcp is absent); child's own mcp/settings apply.
  assert.equal(
    manifest.entities.some((entry) => entry.id === "base-mcp"),
    false,
  );
  assert.ok(manifest.entities.some((entry) => entry.type === "settings" && entry.id === "claude"));
});

test("applyPreset rejects extends targeting an unknown preset", async () => {
  const registryRepo = await mkTmpGitRegistry({
    "harness-registry.json": REGISTRY_MANIFEST,
    "presets/child/preset.json": JSON.stringify(
      {
        id: "child",
        name: "Child",
        extends: "ghost",
        description: "Extends a missing parent.",
        operations: [{ type: "enable_provider", provider: "claude" }],
      },
      null,
      2,
    ),
  });
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await assert.rejects(async () => engine.applyPreset("child", { registry: "corp" }), /PRESET_EXTENDS_NOT_FOUND/u);
});

test("applyPreset rejects a cyclic extends chain", async () => {
  const registryRepo = await mkTmpGitRegistry({
    "harness-registry.json": REGISTRY_MANIFEST,
    "presets/a/preset.json": JSON.stringify(
      {
        id: "a",
        name: "A",
        extends: "b",
        description: "A.",
        operations: [{ type: "enable_provider", provider: "claude" }],
      },
      null,
      2,
    ),
    "presets/b/preset.json": JSON.stringify(
      {
        id: "b",
        name: "B",
        extends: "a",
        description: "B.",
        operations: [{ type: "enable_provider", provider: "claude" }],
      },
      null,
      2,
    ),
  });
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await assert.rejects(async () => engine.applyPreset("a", { registry: "corp" }), /PRESET_EXTENDS_CYCLE/u);
});

test("applyPreset rejects extends on a local preset", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await fs.mkdir(path.join(cwd, ".harness/presets/local-extends"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".harness/presets/local-extends/preset.json"),
    JSON.stringify(
      {
        id: "local-extends",
        name: "Local Extends",
        extends: "starter",
        description: "extends is registry-only.",
        operations: [{ type: "enable_provider", provider: "claude" }],
      },
      null,
      2,
    ),
    "utf8",
  );

  await assert.rejects(async () => engine.applyPreset("local-extends"), /PRESET_EXTENDS_UNSUPPORTED_SOURCE/u);
});

async function readJson<T>(cwd: string, relativePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(cwd, relativePath), "utf8")) as T;
}
