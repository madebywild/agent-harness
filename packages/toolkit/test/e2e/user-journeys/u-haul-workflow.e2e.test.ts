/**
 * E2E User Journey: u-haul migration workflow
 *
 * Covers:
 *   init --u-haul end-to-end migration from provider-owned legacy assets
 *   precedence drops and cross-type collision remaps
 *   canonical source materialization + provider artifact regeneration
 *   provider-specific MCP/prompt/agent/settings conventions
 *   edge cases: precedence override, parse failure, git safety gate, apply error path
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "../cli-helpers.ts";

const execFileAsync = promisify(execFile);

interface InitJsonOutput {
  ok: boolean;
  command: string;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  data: {
    uHaul: {
      noOp: boolean;
      precedence: string[];
      detected: Record<string, number>;
      imported: Record<string, number>;
      autoEnabledProviders: string[];
      deletedLegacyPaths: string[];
      precedenceDrops: Array<{
        entityType: string;
        id: string;
        keptProvider: string;
        droppedProvider: string;
        reason: string;
      }>;
      collisionRemaps: Array<{
        entityType: string;
        provider: string;
        fromId: string;
        toId: string;
      }>;
      apply: {
        operations: number;
        writtenArtifacts: number;
        prunedArtifacts: number;
        diagnostics: number;
        errorDiagnostics: number;
      };
    };
  };
}

interface ManifestJson {
  providers: { enabled: string[] };
  entities: Array<{ type: string; id: string }>;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd });
}

describe("u-haul workflow journey", { timeout: 120_000 }, () => {
  let workspace: string;
  let initPayload: InitJsonOutput;

  test("phase 1 — setup mixed legacy provider assets", async () => {
    workspace = await mkTmpRepo();
    await initGitRepo(workspace);

    await fs.writeFile(path.join(workspace, "AGENTS.md"), "Codex legacy prompt.\n", "utf8");
    await fs.writeFile(path.join(workspace, "CLAUDE.md"), "Claude legacy prompt wins by default.\n", "utf8");
    await fs.mkdir(path.join(workspace, ".github"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".github/copilot-instructions.md"), "Copilot legacy prompt.\n", "utf8");

    await fs.mkdir(path.join(workspace, ".claude/skills/review"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".claude/skills/review/SKILL.md"),
      "# review\n\nPrimary review skill.\n",
      "utf8",
    );
    await fs.writeFile(path.join(workspace, ".claude/skills/review/checklist.md"), "- correctness\n", "utf8");

    await fs.mkdir(path.join(workspace, ".github/skills/review"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".github/skills/review/SKILL.md"),
      "# review\n\nCopilot review variant.\n",
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".codex/config.toml"),
      `
approval_policy = "never"

[mcp_servers.browser]
command = "npx"
args = ["@modelcontextprotocol/server-browser"]

[agents.researcher]
description = "Research tasks"
developer_instructions = "Find relevant sources and summarize"
`.trimStart(),
      "utf8",
    );

    await fs.writeFile(
      path.join(workspace, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            browser: {
              command: "uvx",
              args: ["mcp-browser-alt"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".vscode/mcp.json"),
      JSON.stringify(
        {
          servers: {
            localdocs: {
              command: "node",
              args: ["scripts/localdocs.mjs"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".claude/agents"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".claude/agents/researcher.md"),
      "---\nname: researcher\ndescription: Claude researcher\n---\n\nUse pragmatic research strategy.\n",
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".github/agents"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".github/agents/researcher.agent.md"),
      "---\nname: researcher\ndescription: Copilot researcher\n---\n\nUse extensive research strategy.\n",
      "utf8",
    );

    await fs.writeFile(
      path.join(workspace, ".claude/settings.json"),
      JSON.stringify(
        {
          telemetry: { enabled: true },
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.writeFile(
      path.join(workspace, ".vscode/settings.json"),
      JSON.stringify(
        {
          "editor.tabSize": 2,
          "editor.formatOnSave": true,
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".claude/commands"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".claude/commands/review.md"),
      '---\ndescription: "Review the change request"\n---\n\nReview: $ARGUMENTS\n',
      "utf8",
    );

    await fs.mkdir(path.join(workspace, ".github/prompts"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".github/prompts/review.prompt.md"),
      '---\ndescription: "Review the change request"\n---\n\nReview: $ARGUMENTS\n',
      "utf8",
    );
  });

  test("phase 2 — init --u-haul migrates assets with precedence and remaps", async () => {
    const result = await runHarnessCli(workspace, ["init", "--u-haul", "--json"]);
    initPayload = JSON.parse(result.stdout) as InitJsonOutput;

    assert.equal(initPayload.command, "init");
    assert.equal(initPayload.ok, true);
    assert.equal(initPayload.data.uHaul.noOp, false);
    assert.deepEqual(initPayload.data.uHaul.precedence, ["claude", "codex", "copilot"]);
    assert.deepEqual(initPayload.data.uHaul.autoEnabledProviders, ["claude", "codex", "copilot"]);

    assert.equal(initPayload.data.uHaul.detected.prompt, 3);
    assert.equal(initPayload.data.uHaul.detected.skill, 2);
    assert.equal(initPayload.data.uHaul.detected.mcp, 3);
    assert.equal(initPayload.data.uHaul.detected.subagent, 3);
    assert.equal(initPayload.data.uHaul.detected.settings, 3);
    assert.equal(initPayload.data.uHaul.detected.command, 2);
    assert.equal(initPayload.data.uHaul.detected.hook, 0);

    assert.equal(initPayload.data.uHaul.imported.prompt, 1);
    assert.equal(initPayload.data.uHaul.imported.skill, 1);
    assert.equal(initPayload.data.uHaul.imported.mcp, 2);
    assert.equal(initPayload.data.uHaul.imported.subagent, 1);
    assert.equal(initPayload.data.uHaul.imported.settings, 3);
    assert.equal(initPayload.data.uHaul.imported.command, 1);
    assert.equal(initPayload.data.uHaul.imported.hook, 0);

    assert.ok(
      initPayload.data.uHaul.precedenceDrops.some(
        (drop) =>
          drop.entityType === "prompt" &&
          drop.id === "system" &&
          drop.keptProvider === "claude" &&
          drop.droppedProvider === "codex",
      ),
    );

    assert.ok(
      initPayload.data.uHaul.precedenceDrops.some(
        (drop) =>
          drop.entityType === "command" &&
          drop.id === "review" &&
          drop.keptProvider === "claude" &&
          drop.droppedProvider === "copilot",
      ),
    );

    assert.ok(
      initPayload.data.uHaul.collisionRemaps.some(
        (remap) =>
          remap.entityType === "command" &&
          remap.provider === "claude" &&
          remap.fromId === "review" &&
          remap.toId === "review-command",
      ),
    );

    assert.equal(initPayload.data.uHaul.apply.errorDiagnostics, 0);
  });

  test("phase 3 — canonical sources and provider artifacts match conventions", async () => {
    // Legacy assets were deleted during migration, then managed outputs were regenerated.
    assert.ok(initPayload.data.uHaul.deletedLegacyPaths.includes(".claude/skills"));
    assert.ok(initPayload.data.uHaul.deletedLegacyPaths.includes(".github/skills"));
    assert.ok(initPayload.data.uHaul.deletedLegacyPaths.includes(".claude/agents"));
    assert.ok(initPayload.data.uHaul.deletedLegacyPaths.includes(".github/agents"));

    assert.equal(await fileExists(path.join(workspace, "AGENTS.md")), true, "regenerated as managed output");
    assert.equal(await fileExists(path.join(workspace, "CLAUDE.md")), true, "regenerated as managed output");
    assert.equal(
      await fileExists(path.join(workspace, ".github/copilot-instructions.md")),
      true,
      "regenerated as managed output",
    );

    // Canonical sources.
    const canonicalPrompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
    assert.match(canonicalPrompt, /Claude legacy prompt wins by default/u);

    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/skills/review/SKILL.md")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/mcp/browser.json")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/mcp/localdocs.json")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/subagents/researcher.md")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/settings/codex.toml")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/settings/claude.json")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/settings/copilot.json")));
    await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/commands/review-command.md")));

    // Prompts are rendered for all enabled providers from canonical prompt.
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    const claudePrompt = await readWorkspaceText(workspace, "CLAUDE.md");
    const copilotPrompt = await readWorkspaceText(workspace, ".github/copilot-instructions.md");
    assert.match(codexPrompt, /Claude legacy prompt wins by default/u);
    assert.match(claudePrompt, /Claude legacy prompt wins by default/u);
    assert.match(copilotPrompt, /Claude legacy prompt wins by default/u);

    // MCP + subagents + codex settings converge into Codex TOML conventions.
    const codexConfig = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexConfig, /approval_policy = "never"/u);
    assert.match(codexConfig, /\[mcp_servers\.browser\]/u);
    assert.match(codexConfig, /\[mcp_servers\.localdocs\]/u);
    assert.match(codexConfig, /\[agents\.researcher\]/u);

    // MCP JSON conventions per provider.
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.browser);
    assert.ok(claudeMcp.mcpServers.localdocs);

    const copilotMcp = await readWorkspaceJson<{ servers: Record<string, unknown> }>(workspace, ".vscode/mcp.json");
    assert.ok(copilotMcp.servers.browser);
    assert.ok(copilotMcp.servers.localdocs);

    // Commands are rendered from canonical remapped id.
    assert.ok(await fileExists(path.join(workspace, ".claude/commands/review-command.md")));
    assert.ok(await fileExists(path.join(workspace, ".github/prompts/review-command.prompt.md")));
    assert.equal(await fileExists(path.join(workspace, ".claude/commands/review.md")), false);
    assert.equal(await fileExists(path.join(workspace, ".github/prompts/review.prompt.md")), false);

    // Manifest confirms enabled providers and remapped command entity.
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.deepEqual([...manifest.providers.enabled].sort(), ["claude", "codex", "copilot"]);
    assert.ok(manifest.entities.some((entity) => entity.type === "command" && entity.id === "review-command"));
  });
});

describe("u-haul edge cases", { timeout: 120_000 }, () => {
  test("precedence override selects codex prompt as canonical source", async () => {
    const workspace = await mkTmpRepo();
    await initGitRepo(workspace);
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "Codex prompt source.\n", "utf8");
    await fs.writeFile(path.join(workspace, "CLAUDE.md"), "Claude prompt source.\n", "utf8");

    const result = await runHarnessCli(workspace, ["init", "--u-haul", "--u-haul-precedence", "codex", "--json"]);
    const payload = JSON.parse(result.stdout) as InitJsonOutput;

    assert.equal(payload.ok, true);
    assert.deepEqual(payload.data.uHaul.precedence, ["codex", "claude", "copilot"]);
    const canonicalPrompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
    assert.equal(canonicalPrompt.trim(), "Codex prompt source.");
  });

  test("parse errors fail before mutation and preserve legacy files", async () => {
    const workspace = await mkTmpRepo();
    await initGitRepo(workspace);
    await fs.mkdir(path.join(workspace, ".claude/commands"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".claude/commands/bad.md"), "Malformed command\n", "utf8");

    const failed = await runHarnessCliExpectFailure(workspace, ["init", "--u-haul"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /U_HAUL_PARSE_FAILED/u);

    assert.equal(await fileExists(path.join(workspace, ".harness")), false);
    assert.equal(await fileExists(path.join(workspace, ".claude/commands/bad.md")), true);
  });

  test("git safety gate blocks deletions outside a git worktree", async () => {
    const workspace = await mkTmpRepo();
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "Legacy prompt\n", "utf8");

    const failed = await runHarnessCliExpectFailure(workspace, ["init", "--u-haul"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /U_HAUL_GIT_WORKTREE_REQUIRED/u);

    assert.equal(await fileExists(path.join(workspace, ".harness")), false);
    assert.equal(await fileExists(path.join(workspace, "AGENTS.md")), true);
  });

  test("incompatible imported hook returns non-zero init result with json payload", async () => {
    const workspace = await mkTmpRepo();
    await initGitRepo(workspace);
    await fs.writeFile(path.join(workspace, "CLAUDE.md"), "Claude prompt\n", "utf8");
    await fs.mkdir(path.join(workspace, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".codex/config.toml"),
      `notify = ["python3", "scripts/notify.py"]\n`,
      "utf8",
    );

    const failed = await runHarnessCliExpectFailure(workspace, ["init", "--u-haul", "--json"]);
    assert.equal(failed.code, 1);
    assert.ok(failed.stdout.trim().length > 0, "expected JSON payload in stdout");

    const payload = JSON.parse(failed.stdout) as InitJsonOutput;
    assert.equal(payload.command, "init");
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "INIT_U_HAUL_APPLY_FAILED"));
    assert.ok(payload.data.uHaul.apply.errorDiagnostics > 0);
  });
});
