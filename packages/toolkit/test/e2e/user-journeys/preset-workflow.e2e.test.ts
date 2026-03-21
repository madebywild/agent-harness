/**
 * E2E User Journey: Preset-driven workspace setup and evolution
 *
 * Simulates real user flows that start from presets and evolve:
 *   Scenario A — starter preset:
 *     init --preset starter → verify materialized state → apply → verify outputs
 *     → customise preset-provided prompt → add entities on top → re-apply
 *     → remove a preset-provided entity → apply → verify pruning
 *     → validate & plan idempotency
 *   Scenario B — yolo preset:
 *     init --preset yolo → verify settings for all providers → apply
 *     → add entities on top of permissive settings → re-apply
 *     → verify settings merge correctly with hook/MCP state
 *     → modify provider settings → apply → verify updates propagate
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli } from "../cli-helpers.ts";

// ---------------------------------------------------------------------------
// Types for JSON payloads
// ---------------------------------------------------------------------------
interface ManifestJson {
  version: number;
  providers: { enabled: string[] };
  entities: Array<{
    type: string;
    id: string;
    registry: string;
    sourcePath: string;
    overrides?: Record<string, string>;
  }>;
}

interface LockJson {
  version: number;
  entities: Array<{ type: string; id: string; sourceSha256: string }>;
  outputs: Array<{ path: string; provider: string; contentSha256: string }>;
}

interface ManagedIndexJson {
  version: number;
  managedSourcePaths: string[];
  managedOutputPaths: string[];
}

interface ApplyJsonOutput {
  ok: boolean;
  data: {
    result: {
      operations: Array<{ type: string; path: string; provider?: string; reason: string }>;
      diagnostics: Array<{ code: string; severity: string; message: string }>;
      writtenArtifacts: string[];
      prunedArtifacts: string[];
    };
  };
}

interface PlanJsonOutput {
  ok: boolean;
  data: {
    result: {
      operations: Array<{ type: string; path: string; provider?: string }>;
      diagnostics: Array<{ code: string; severity: string }>;
    };
  };
}

interface ValidateJsonOutput {
  ok: boolean;
  data: { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string; message: string }> } };
}

interface DoctorJsonOutput {
  ok: boolean;
  data: { result: { healthy: boolean; migrationNeeded: boolean } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

// ===========================================================================
// Scenario A: starter preset → customise → extend → prune
// ===========================================================================
describe("preset workflow: starter preset lifecycle", { timeout: 120_000 }, () => {
  let workspace: string;

  // ---- Phase 1: init --preset starter ------------------------------------
  test("phase 1 — init with starter preset scaffolds providers, prompt, skill, and command", async () => {
    workspace = await mkTmpRepo();

    await runHarnessCli(workspace, ["init", "--preset", "starter"]);

    // Workspace files exist
    assert.ok(await fileExists(path.join(workspace, ".harness/manifest.json")));
    assert.ok(await fileExists(path.join(workspace, ".harness/manifest.lock.json")));

    // Manifest has correct state
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);

    const entityKeys = manifest.entities.map((e) => `${e.type}:${e.id}`);
    assert.ok(entityKeys.includes("prompt:system"));
    assert.ok(entityKeys.includes("skill:reviewer"));
    assert.ok(entityKeys.includes("command:fix-issue"));

    // Source files materialized from embedded content
    assert.ok(await fileExists(path.join(workspace, ".harness/src/prompts/system.md")));
    assert.ok(await fileExists(path.join(workspace, ".harness/src/skills/reviewer/SKILL.md")));
    assert.ok(await fileExists(path.join(workspace, ".harness/src/commands/fix-issue.md")));

    // Source content matches embedded preset
    const prompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
    assert.match(prompt, /implementation-focused/u);
    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /rigorous code review/u);
  });

  // ---- Phase 2: apply generates provider artifacts -----------------------
  test("phase 2 — apply generates artifacts for all three providers", async () => {
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;

    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Claude outputs
    assert.ok(await fileExists(path.join(workspace, "CLAUDE.md")));
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")));
    assert.ok(await fileExists(path.join(workspace, ".claude/commands/fix-issue.md")));
    const claudePrompt = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.match(claudePrompt, /implementation-focused/u);

    // Codex outputs
    assert.ok(await fileExists(path.join(workspace, "AGENTS.md")));
    assert.ok(await fileExists(path.join(workspace, ".codex/skills/reviewer/SKILL.md")));
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    assert.match(codexPrompt, /implementation-focused/u);

    // Copilot outputs
    assert.ok(await fileExists(path.join(workspace, ".github/copilot-instructions.md")));
    assert.ok(await fileExists(path.join(workspace, ".github/skills/reviewer/SKILL.md")));
    assert.ok(await fileExists(path.join(workspace, ".github/prompts/fix-issue.prompt.md")));
  });

  // ---- Phase 3: customise the preset-provided prompt ---------------------
  test("phase 3 — customise preset prompt, re-apply propagates to all providers", async () => {
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompts/system.md"),
      "You are a backend systems engineer.\n\nFocus on correctness, observability, and graceful degradation.\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const updates = apply.data.result.operations.filter((op) => op.type === "update");
    assert.ok(updates.length > 0, "should have update operations for prompt");

    // All three provider prompts updated
    assert.match(await readWorkspaceText(workspace, "CLAUDE.md"), /backend systems engineer/u);
    assert.match(await readWorkspaceText(workspace, "AGENTS.md"), /backend systems engineer/u);
    assert.match(await readWorkspaceText(workspace, ".github/copilot-instructions.md"), /backend systems engineer/u);

    // Old preset content gone
    assert.doesNotMatch(await readWorkspaceText(workspace, "CLAUDE.md"), /implementation-focused/u);
  });

  // ---- Phase 4: add entities on top of preset ----------------------------
  test("phase 4 — add MCP, hook, and subagent on top of preset entities", async () => {
    await runHarnessCli(workspace, ["add", "mcp", "playwright"]);
    await fs.writeFile(
      path.join(workspace, ".harness/src/mcp/playwright.json"),
      JSON.stringify({ servers: { playwright: { command: "npx", args: ["@anthropic-ai/playwright-mcp"] } } }, null, 2),
      "utf8",
    );

    await runHarnessCli(workspace, ["add", "hook", "format-check"]);
    await fs.writeFile(
      path.join(workspace, ".harness/src/hooks/format-check.json"),
      JSON.stringify(
        {
          mode: "best_effort",
          events: {
            post_tool_use: [{ type: "command", command: "npm run format:check", timeoutSec: 15 }],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await runHarnessCli(workspace, ["add", "subagent", "planner"]);
    await fs.writeFile(
      path.join(workspace, ".harness/src/subagents/planner.md"),
      "---\nname: planner\ndescription: Break down complex tasks into actionable steps.\n---\n\nYou are a planning assistant. Decompose the task and output a numbered plan.\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Manifest now has preset + manually added entities
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.entities.length, 6);
    const entityKeys = manifest.entities.map((e) => `${e.type}:${e.id}`);
    assert.ok(entityKeys.includes("mcp_config:playwright"));
    assert.ok(entityKeys.includes("hook:format-check"));
    assert.ok(entityKeys.includes("subagent:planner"));

    // MCP outputs present
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.playwright);
    assert.ok(await fileExists(path.join(workspace, ".codex/config.toml")));
    assert.ok(await fileExists(path.join(workspace, ".vscode/mcp.json")));

    // Subagent outputs present
    assert.ok(await fileExists(path.join(workspace, ".claude/agents/planner.md")));
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexToml, /\[agents\.planner\]/u);
    assert.ok(await fileExists(path.join(workspace, ".github/agents/planner.agent.md")));

    // Hook outputs present
    const claudeSettings = await readWorkspaceJson<{ hooks?: Record<string, unknown[]> }>(
      workspace,
      ".claude/settings.json",
    );
    assert.ok(claudeSettings.hooks?.PostToolUse);
  });

  // ---- Phase 5: re-apply is idempotent -----------------------------------
  test("phase 5 — re-apply is idempotent after mixed preset + manual entities", async () => {
    const lockBefore = await readWorkspaceText(workspace, ".harness/manifest.lock.json");

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const nonNoop = apply.data.result.operations.filter((op) => op.type !== "noop");
    assert.equal(nonNoop.length, 0, `expected all noop, got: ${JSON.stringify(nonNoop)}`);

    const lockAfter = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
    assert.equal(lockAfter, lockBefore, "lock should be byte-stable");
  });

  // ---- Phase 6: remove a preset-provided entity --------------------------
  test("phase 6 — remove preset-provided skill, apply prunes its outputs", async () => {
    await runHarnessCli(workspace, ["remove", "skill", "reviewer"]);

    assert.ok(!(await fileExists(path.join(workspace, ".harness/src/skills/reviewer"))), "reviewer source deleted");

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    assert.ok(!(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md"))), "claude skill pruned");
    assert.ok(!(await fileExists(path.join(workspace, ".codex/skills/reviewer/SKILL.md"))), "codex skill pruned");
    assert.ok(!(await fileExists(path.join(workspace, ".github/skills/reviewer/SKILL.md"))), "copilot skill pruned");

    // Other entities still intact
    assert.ok(await fileExists(path.join(workspace, "CLAUDE.md")));
    assert.ok(await fileExists(path.join(workspace, ".claude/agents/planner.md")));
  });

  // ---- Phase 7: validate and doctor on healthy state ---------------------
  test("phase 7 — validate and doctor pass on mixed preset + manual workspace", async () => {
    const vResult = await runHarnessCli(workspace, ["validate", "--json"]);
    const validate = JSON.parse(vResult.stdout) as ValidateJsonOutput;
    assert.equal(validate.data.result.valid, true, JSON.stringify(validate.data.result.diagnostics));

    const dResult = await runHarnessCli(workspace, ["doctor", "--json"]);
    const doctor = JSON.parse(dResult.stdout) as DoctorJsonOutput;
    assert.equal(doctor.data.result.healthy, true);
    assert.equal(doctor.data.result.migrationNeeded, false);
  });

  // ---- Phase 8: plan shows only noop ------------------------------------
  test("phase 8 — plan after final apply shows all noop", async () => {
    const result = await runHarnessCli(workspace, ["plan", "--json"]);
    const plan = JSON.parse(result.stdout) as PlanJsonOutput;
    assert.equal(plan.ok, true);

    const nonNoop = plan.data.result.operations.filter((op) => op.type !== "noop");
    assert.equal(nonNoop.length, 0, `expected all noop, got: ${JSON.stringify(nonNoop)}`);
  });

  // ---- Phase 9: final consistency ----------------------------------------
  test("phase 9 — final manifest, lock, and managed index are consistent", async () => {
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    const managedIndex = await readWorkspaceJson<ManagedIndexJson>(workspace, ".harness/managed-index.json");

    assert.equal(lock.entities.length, manifest.entities.length);
    assert.deepEqual([...manifest.providers.enabled].sort(), ["claude", "codex", "copilot"]);

    for (const outputPath of managedIndex.managedOutputPaths) {
      assert.ok(await fileExists(path.join(workspace, outputPath)), `managed output should exist: ${outputPath}`);
    }
    for (const sourcePath of managedIndex.managedSourcePaths) {
      assert.ok(await fileExists(path.join(workspace, sourcePath)), `managed source should exist: ${sourcePath}`);
    }
  });
});

// ===========================================================================
// Scenario B: yolo preset → settings merge with entities
// ===========================================================================
describe("preset workflow: yolo preset with permissive settings", { timeout: 120_000 }, () => {
  let workspace: string;

  // ---- Phase 1: init --preset yolo --------------------------------------
  test("phase 1 — init with yolo preset enables all providers and creates settings", async () => {
    workspace = await mkTmpRepo();

    await runHarnessCli(workspace, ["init", "--preset", "yolo"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);

    const entityKeys = manifest.entities.map((e) => `${e.type}:${e.id}`);
    assert.ok(entityKeys.includes("prompt:system"));
    assert.ok(entityKeys.includes("settings:claude"));
    assert.ok(entityKeys.includes("settings:codex"));
    assert.ok(entityKeys.includes("settings:copilot"));

    // Settings sources exist with correct content
    const claudeSettings = await readWorkspaceJson<{ permissions: { defaultMode: string; allow: string[] } }>(
      workspace,
      ".harness/src/settings/claude.json",
    );
    assert.equal(claudeSettings.permissions.defaultMode, "bypassPermissions");
    assert.ok(claudeSettings.permissions.allow.includes("Bash"));
    assert.ok(claudeSettings.permissions.allow.includes("mcp__*"));

    // Codex uses TOML
    assert.ok(await fileExists(path.join(workspace, ".harness/src/settings/codex.toml")));
    const codexToml = await readWorkspaceText(workspace, ".harness/src/settings/codex.toml");
    assert.match(codexToml, /approval_policy = "never"/u);
    assert.match(codexToml, /sandbox_mode = "danger-full-access"/u);

    const copilotSettings = await readWorkspaceJson<Record<string, unknown>>(
      workspace,
      ".harness/src/settings/copilot.json",
    );
    assert.equal(copilotSettings["chat.tools.global.autoApprove"], true);
    assert.equal(copilotSettings["chat.autopilot.enabled"], true);

    // Prompt source
    const prompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
    assert.match(prompt, /full autonomy/u);
  });

  // ---- Phase 2: apply renders settings into provider artifacts -----------
  test("phase 2 — apply renders settings into provider-specific config files", async () => {
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Claude: settings land in .claude/settings.json
    const claudeOutput = await readWorkspaceJson<{ permissions: { defaultMode: string } }>(
      workspace,
      ".claude/settings.json",
    );
    assert.equal(claudeOutput.permissions.defaultMode, "bypassPermissions");

    // Codex: settings land in .codex/config.toml
    const codexOutput = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexOutput, /approval_policy = "never"/u);
    assert.match(codexOutput, /sandbox_mode = "danger-full-access"/u);

    // Copilot: settings land in .vscode/settings.json
    const copilotOutput = await readWorkspaceJson<Record<string, unknown>>(workspace, ".vscode/settings.json");
    assert.equal(copilotOutput["chat.tools.global.autoApprove"], true);
    assert.equal(copilotOutput["chat.autopilot.enabled"], true);

    // Prompt outputs
    assert.match(await readWorkspaceText(workspace, "CLAUDE.md"), /full autonomy/u);
    assert.match(await readWorkspaceText(workspace, "AGENTS.md"), /full autonomy/u);
    assert.match(await readWorkspaceText(workspace, ".github/copilot-instructions.md"), /full autonomy/u);
  });

  // ---- Phase 3: add MCP + hook on top of yolo settings -------------------
  test("phase 3 — add MCP and hook, settings merge correctly with new state", async () => {
    await runHarnessCli(workspace, ["add", "mcp", "github"]);
    await fs.writeFile(
      path.join(workspace, ".harness/src/mcp/github.json"),
      JSON.stringify({ servers: { github: { command: "gh", args: ["mcp-server"] } } }, null, 2),
      "utf8",
    );

    await runHarnessCli(workspace, ["add", "hook", "test-runner"]);
    await fs.writeFile(
      path.join(workspace, ".harness/src/hooks/test-runner.json"),
      JSON.stringify(
        {
          mode: "best_effort",
          events: {
            post_tool_use: [{ type: "command", command: "npm test", timeoutSec: 60 }],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Claude: settings.json should have BOTH permissions AND hooks
    const claudeOutput = await readWorkspaceJson<{
      permissions: { defaultMode: string };
      hooks?: Record<string, unknown[]>;
    }>(workspace, ".claude/settings.json");
    assert.equal(claudeOutput.permissions.defaultMode, "bypassPermissions", "settings preserved after merge");
    assert.ok(claudeOutput.hooks?.PostToolUse, "hook merged into settings output");

    // Claude: MCP in separate file
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.github, "MCP server present");

    // Codex: config.toml should have settings + MCP merged
    const codexOutput = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexOutput, /approval_policy = "never"/u, "codex settings preserved");
    assert.match(codexOutput, /\[mcp_servers\.github\]/u, "codex MCP merged");

    // Copilot: settings in .vscode/settings.json, MCP in .vscode/mcp.json (separate)
    const copilotSettings = await readWorkspaceJson<Record<string, unknown>>(workspace, ".vscode/settings.json");
    assert.equal(copilotSettings["chat.tools.global.autoApprove"], true, "copilot settings preserved");
    assert.ok(await fileExists(path.join(workspace, ".vscode/mcp.json")), "copilot MCP exists");
  });

  // ---- Phase 4: modify settings source, apply updates --------------------
  test("phase 4 — modify codex settings source, re-apply propagates changes", async () => {
    // Relax codex to workspace-write sandbox
    await fs.writeFile(
      path.join(workspace, ".harness/src/settings/codex.toml"),
      'approval_policy = "never"\nsandbox_mode = "workspace-write"\n',
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const updates = apply.data.result.operations.filter((op) => op.type === "update");
    assert.ok(updates.length > 0, "should have update operations");

    const codexOutput = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexOutput, /sandbox_mode = "workspace-write"/u);
    assert.doesNotMatch(codexOutput, /danger-full-access/u);
    // MCP should still be present
    assert.match(codexOutput, /\[mcp_servers\.github\]/u);
  });

  // ---- Phase 5: idempotent after settings change -------------------------
  test("phase 5 — re-apply is idempotent after settings change", async () => {
    const lockBefore = await readWorkspaceText(workspace, ".harness/manifest.lock.json");

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const nonNoop = apply.data.result.operations.filter((op) => op.type !== "noop");
    assert.equal(nonNoop.length, 0, `expected all noop, got: ${JSON.stringify(nonNoop)}`);

    const lockAfter = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
    assert.equal(lockAfter, lockBefore);
  });

  // ---- Phase 6: disable provider, settings artifact pruned ---------------
  test("phase 6 — disable copilot, its settings output is pruned", async () => {
    await runHarnessCli(workspace, ["provider", "disable", "copilot"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const pruned = apply.data.result.prunedArtifacts;
    assert.ok(
      pruned.some((p) => p.includes(".vscode/settings.json")),
      "copilot settings pruned",
    );
    assert.ok(
      pruned.some((p) => p.includes(".github/")),
      "copilot outputs pruned",
    );

    assert.ok(!(await fileExists(path.join(workspace, ".vscode/settings.json"))));
    assert.ok(!(await fileExists(path.join(workspace, ".github/copilot-instructions.md"))));

    // Other providers intact
    assert.ok(await fileExists(path.join(workspace, ".claude/settings.json")));
    assert.ok(await fileExists(path.join(workspace, ".codex/config.toml")));
  });

  // ---- Phase 7: re-enable copilot, settings regenerated ------------------
  test("phase 7 — re-enable copilot, settings output regenerated", async () => {
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const created = apply.data.result.operations.filter((op) => op.type === "create" && op.provider === "copilot");
    assert.ok(created.length > 0, "should create copilot outputs");

    const copilotSettings = await readWorkspaceJson<Record<string, unknown>>(workspace, ".vscode/settings.json");
    assert.equal(copilotSettings["chat.tools.global.autoApprove"], true);
  });

  // ---- Phase 8: validate and final consistency ---------------------------
  test("phase 8 — validate passes and final state is consistent", async () => {
    const vResult = await runHarnessCli(workspace, ["validate", "--json"]);
    const validate = JSON.parse(vResult.stdout) as ValidateJsonOutput;
    assert.equal(validate.data.result.valid, true, JSON.stringify(validate.data.result.diagnostics));

    const dResult = await runHarnessCli(workspace, ["doctor", "--json"]);
    const doctor = JSON.parse(dResult.stdout) as DoctorJsonOutput;
    assert.equal(doctor.data.result.healthy, true);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    const managedIndex = await readWorkspaceJson<ManagedIndexJson>(workspace, ".harness/managed-index.json");

    assert.equal(lock.entities.length, manifest.entities.length);
    assert.deepEqual([...manifest.providers.enabled].sort(), ["claude", "codex", "copilot"]);

    for (const outputPath of managedIndex.managedOutputPaths) {
      assert.ok(await fileExists(path.join(workspace, outputPath)), `managed output should exist: ${outputPath}`);
    }
  });
});
