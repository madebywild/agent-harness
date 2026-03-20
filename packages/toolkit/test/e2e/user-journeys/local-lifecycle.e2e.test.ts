/**
 * E2E User Journey: Complete local lifecycle
 *
 * Simulates a real user flow through the harness CLI:
 *   init → add every entity type → enable all providers → apply → verify outputs
 *   → modify sources → re-apply → verify updates propagate
 *   → remove some entities → apply → verify pruning
 *   → disable a provider → apply → verify stale outputs removed
 *   → re-enable → apply → verify regenerated
 *   → validate & doctor on healthy workspace
 *   → plan idempotency (back-to-back apply produces identical lock)
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli } from "../cli-helpers.ts";

// ---------------------------------------------------------------------------
// Types for JSON payloads we read back
// ---------------------------------------------------------------------------
interface ManifestJson {
  version: number;
  providers: { enabled: string[] };
  registries: { default: string; entries: Record<string, { type: string }> };
  entities: Array<{
    type: string;
    id: string;
    registry: string;
    sourcePath: string;
    overrides?: Record<string, string>;
    enabled?: boolean;
  }>;
}

interface LockJson {
  version: number;
  generatedAt: string;
  manifestFingerprint: string;
  entities: Array<{
    type: string;
    id: string;
    registry: string;
    sourceSha256: string;
  }>;
  outputs: Array<{
    path: string;
    provider: string;
    contentSha256: string;
  }>;
}

interface ManagedIndexJson {
  version: number;
  managedSourcePaths: string[];
  managedOutputPaths: string[];
}

interface ApplyJsonOutput {
  schemaVersion: string;
  ok: boolean;
  command: string;
  data: {
    result: {
      operations: Array<{ type: string; path: string; provider?: string; reason: string }>;
      diagnostics: Array<{ code: string; severity: string; message: string }>;
      writtenArtifacts: string[];
      prunedArtifacts: string[];
    };
  };
}

interface ValidateJsonOutput {
  ok: boolean;
  data: {
    result: {
      valid: boolean;
      diagnostics: Array<{ code: string; severity: string; message: string }>;
    };
  };
}

interface DoctorJsonOutput {
  ok: boolean;
  data: {
    result: {
      healthy: boolean;
      migrationNeeded: boolean;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------
describe("local lifecycle journey", { timeout: 120_000 }, () => {
  let workspace: string;

  // ---- Phase 1: Initialise workspace -------------------------------------
  test("phase 1 — init creates workspace skeleton", async () => {
    workspace = await mkTmpRepo();

    await runHarnessCli(workspace, ["init"]);

    assert.ok(await fileExists(path.join(workspace, ".harness/manifest.json")));
    assert.ok(await fileExists(path.join(workspace, ".harness/manifest.lock.json")));
    assert.ok(await fileExists(path.join(workspace, ".harness/managed-index.json")));

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.providers.enabled, []);
    assert.equal(manifest.registries.default, "local");
    assert.deepEqual(manifest.entities, []);
  });

  // ---- Phase 2: Add every entity type ------------------------------------
  test("phase 2 — add all entity types", async () => {
    await runHarnessCli(workspace, ["add", "prompt"]);
    await runHarnessCli(workspace, ["add", "skill", "reviewer"]);
    await runHarnessCli(workspace, ["add", "skill", "security-audit"]);
    await runHarnessCli(workspace, ["add", "mcp", "playwright"]);
    await runHarnessCli(workspace, ["add", "mcp", "sentry"]);
    await runHarnessCli(workspace, ["add", "subagent", "researcher"]);
    await runHarnessCli(workspace, ["add", "hook", "lint-guard"]);
    await runHarnessCli(workspace, ["add", "hook", "notify-slack"]);

    // Verify source files exist
    const sources = [
      ".harness/src/prompts/system.md",
      ".harness/src/skills/reviewer/SKILL.md",
      ".harness/src/skills/security-audit/SKILL.md",
      ".harness/src/mcp/playwright.json",
      ".harness/src/mcp/sentry.json",
      ".harness/src/subagents/researcher.md",
      ".harness/src/hooks/lint-guard.json",
      ".harness/src/hooks/notify-slack.json",
    ];
    for (const source of sources) {
      assert.ok(await fileExists(path.join(workspace, source)), `expected source file: ${source}`);
    }

    // Verify manifest entities
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.entities.length, 8);

    const entityKeys = manifest.entities.map((e) => `${e.type}:${e.id}`);
    assert.ok(entityKeys.includes("prompt:system"));
    assert.ok(entityKeys.includes("skill:reviewer"));
    assert.ok(entityKeys.includes("skill:security-audit"));
    assert.ok(entityKeys.includes("mcp_config:playwright"));
    assert.ok(entityKeys.includes("mcp_config:sentry"));
    assert.ok(entityKeys.includes("subagent:researcher"));
    assert.ok(entityKeys.includes("hook:lint-guard"));
    assert.ok(entityKeys.includes("hook:notify-slack"));

    // All local registry
    for (const entity of manifest.entities) {
      assert.equal(entity.registry, "local");
    }

    // Each entity should have override files for all 3 providers
    for (const entity of manifest.entities) {
      assert.ok(entity.overrides?.claude, `${entity.id} missing claude override`);
      assert.ok(entity.overrides?.codex, `${entity.id} missing codex override`);
      assert.ok(entity.overrides?.copilot, `${entity.id} missing copilot override`);
    }
  });

  // ---- Phase 3: Customise source content before enabling providers -------
  test("phase 3 — customise entity sources with realistic content", async () => {
    // Prompt
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompts/system.md"),
      "You are a senior staff engineer AI assistant.\n\nAlways write tests before implementation.\n",
      "utf8",
    );

    // MCP configs
    await fs.writeFile(
      path.join(workspace, ".harness/src/mcp/playwright.json"),
      JSON.stringify({ servers: { playwright: { command: "npx", args: ["@anthropic-ai/playwright-mcp"] } } }, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspace, ".harness/src/mcp/sentry.json"),
      JSON.stringify(
        { servers: { sentry: { command: "npx", args: ["@sentry/mcp-server"], env: { SENTRY_TOKEN: "tok" } } } },
        null,
        2,
      ),
      "utf8",
    );

    // Skill: reviewer
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/reviewer/SKILL.md"),
      "---\nname: reviewer\ndescription: Reviews pull requests for correctness.\n---\n\n# Code Reviewer\n\nCheck for bugs, style issues, and test coverage.\n",
      "utf8",
    );

    // Skill: security-audit (multi-file)
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/security-audit/SKILL.md"),
      "---\nname: security-audit\ndescription: Audits code for security vulnerabilities.\n---\n\n# Security Audit\n\nFollow the OWASP top 10 checklist.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/security-audit/owasp-checklist.md"),
      "- SQL Injection\n- XSS\n- CSRF\n- Auth bypass\n",
      "utf8",
    );

    // Subagent
    await fs.writeFile(
      path.join(workspace, ".harness/src/subagents/researcher.md"),
      "---\nname: researcher\ndescription: Searches the web for relevant information.\n---\n\nYou are a research assistant. Search the web and summarise findings.\n",
      "utf8",
    );

    // Hook: lint-guard (cross-provider: pre_tool_use works on claude+copilot, skipped on codex)
    await fs.writeFile(
      path.join(workspace, ".harness/src/hooks/lint-guard.json"),
      JSON.stringify(
        {
          mode: "best_effort",
          events: {
            pre_tool_use: [
              {
                type: "command",
                matcher: "Bash",
                command: "npm run lint -- --quiet",
                bash: "npm run lint -- --quiet",
                powershell: "npm run lint -- --quiet",
                timeoutSec: 30,
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // Hook: notify-slack (turn_complete → works on codex, skipped on others)
    await fs.writeFile(
      path.join(workspace, ".harness/src/hooks/notify-slack.json"),
      JSON.stringify(
        {
          mode: "best_effort",
          events: {
            turn_complete: [
              {
                type: "notify",
                command: ["python3", "scripts/slack-notify.py"],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  // ---- Phase 4: Enable all three providers and apply ---------------------
  test("phase 4 — enable all providers and apply", async () => {
    await runHarnessCli(workspace, ["provider", "enable", "codex"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;

    assert.equal(apply.ok, true);
    assert.equal(
      apply.data.result.diagnostics.filter((d) => d.severity === "error").length,
      0,
      `unexpected errors: ${apply.data.result.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => d.code)
        .join(", ")}`,
    );

    // --- Codex outputs ---
    assert.ok(await fileExists(path.join(workspace, "AGENTS.md")), "codex prompt");
    assert.ok(await fileExists(path.join(workspace, ".codex/skills/reviewer/SKILL.md")), "codex reviewer skill");
    assert.ok(
      await fileExists(path.join(workspace, ".codex/skills/security-audit/SKILL.md")),
      "codex security-audit skill",
    );
    assert.ok(
      await fileExists(path.join(workspace, ".codex/skills/security-audit/owasp-checklist.md")),
      "codex owasp-checklist",
    );
    assert.ok(await fileExists(path.join(workspace, ".codex/config.toml")), "codex config.toml");

    // codex config.toml should have MCP servers, subagent, and notify
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexToml, /\[mcp_servers\.playwright\]/u, "codex has playwright MCP");
    assert.match(codexToml, /\[mcp_servers\.sentry\]/u, "codex has sentry MCP");
    assert.match(codexToml, /\[agents\.researcher\]/u, "codex has researcher agent");
    assert.match(codexToml, /notify/u, "codex has notify from hook");

    // --- Claude outputs ---
    assert.ok(await fileExists(path.join(workspace, "CLAUDE.md")), "claude prompt");
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")), "claude reviewer skill");
    assert.ok(
      await fileExists(path.join(workspace, ".claude/skills/security-audit/SKILL.md")),
      "claude security-audit skill",
    );
    assert.ok(await fileExists(path.join(workspace, ".mcp.json")), "claude MCP config");
    assert.ok(await fileExists(path.join(workspace, ".claude/agents/researcher.md")), "claude subagent");
    assert.ok(await fileExists(path.join(workspace, ".claude/settings.json")), "claude hook settings");

    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.playwright, "claude MCP has playwright");
    assert.ok(claudeMcp.mcpServers.sentry, "claude MCP has sentry");

    const claudeSettings = await readWorkspaceJson<{
      hooks?: Record<string, unknown[]>;
    }>(workspace, ".claude/settings.json");
    assert.ok(claudeSettings.hooks?.PreToolUse, "claude hooks has PreToolUse from lint-guard");

    // --- Copilot outputs ---
    assert.ok(await fileExists(path.join(workspace, ".github/copilot-instructions.md")), "copilot prompt");
    assert.ok(await fileExists(path.join(workspace, ".github/skills/reviewer/SKILL.md")), "copilot reviewer skill");
    assert.ok(await fileExists(path.join(workspace, ".vscode/mcp.json")), "copilot MCP config");
    assert.ok(await fileExists(path.join(workspace, ".github/agents/researcher.agent.md")), "copilot subagent");
    assert.ok(await fileExists(path.join(workspace, ".github/hooks/harness.generated.json")), "copilot hook config");

    // Verify prompt content matches source
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    assert.match(codexPrompt, /senior staff engineer/u, "codex prompt has custom content");
    const claudePrompt = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.match(claudePrompt, /senior staff engineer/u, "claude prompt has custom content");

    // Verify lock tracks all entities
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    assert.equal(lock.entities.length, 8);
    assert.ok(lock.outputs.length > 0, "lock tracks output artifacts");

    // Verify managed index
    const managedIndex = await readWorkspaceJson<ManagedIndexJson>(workspace, ".harness/managed-index.json");
    assert.ok(managedIndex.managedSourcePaths.length > 0, "managed index has source paths");
    assert.ok(managedIndex.managedOutputPaths.length > 0, "managed index has output paths");
  });

  // ---- Phase 5: Apply again → idempotent (no changes) -------------------
  test("phase 5 — re-apply is idempotent", async () => {
    const lockBefore = await readWorkspaceText(workspace, ".harness/manifest.lock.json");

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;

    assert.equal(apply.ok, true);

    // All operations should be noop
    const nonNoop = apply.data.result.operations.filter((op) => op.type !== "noop");
    assert.equal(nonNoop.length, 0, `expected all noop, got: ${JSON.stringify(nonNoop)}`);

    // Lock file should be byte-identical (no generatedAt bump)
    const lockAfter = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
    assert.equal(lockAfter, lockBefore, "lock should be byte-stable on no-op apply");
  });

  // ---- Phase 6: Modify a source → re-apply → verify updates -------------
  test("phase 6 — modify prompt and skill, re-apply propagates changes", async () => {
    // Modify the prompt
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompts/system.md"),
      "You are an expert TypeScript engineer.\n\nFollow strict null checks and prefer immutable patterns.\n",
      "utf8",
    );

    // Modify the reviewer skill
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/reviewer/SKILL.md"),
      "---\nname: reviewer\ndescription: Reviews code with a focus on TypeScript best practices.\n---\n\n# Code Reviewer v2\n\nFocus on type safety, null checks, and idiomatic patterns.\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Should have update operations for prompt and skill files
    const updates = apply.data.result.operations.filter((op) => op.type === "update");
    assert.ok(updates.length > 0, "should have update operations");

    // Verify updated content in outputs
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    assert.match(codexPrompt, /expert TypeScript engineer/u);
    assert.doesNotMatch(codexPrompt, /senior staff engineer/u);

    const claudeReviewer = await readWorkspaceText(workspace, ".claude/skills/reviewer/SKILL.md");
    assert.match(claudeReviewer, /Code Reviewer v2/u);

    const copilotReviewer = await readWorkspaceText(workspace, ".github/skills/reviewer/SKILL.md");
    assert.match(copilotReviewer, /Code Reviewer v2/u);
  });

  // ---- Phase 7: Remove entities → apply → verify pruning ----------------
  test("phase 7 — remove entities and apply prunes outputs", async () => {
    // Remove the sentry MCP (default deletes source)
    await runHarnessCli(workspace, ["remove", "mcp", "sentry"]);

    // Remove the security-audit skill (default deletes source)
    await runHarnessCli(workspace, ["remove", "skill", "security-audit"]);

    // Verify source files are gone
    assert.ok(!(await fileExists(path.join(workspace, ".harness/src/mcp/sentry.json"))), "sentry source deleted");
    assert.ok(
      !(await fileExists(path.join(workspace, ".harness/src/skills/security-audit"))),
      "security-audit dir deleted",
    );

    // Verify manifest updated
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.entities.length, 6);
    assert.ok(!manifest.entities.some((e) => e.id === "sentry"));
    assert.ok(!manifest.entities.some((e) => e.id === "security-audit"));

    // Apply to clean up outputs
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Verify MCP configs no longer have sentry
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.doesNotMatch(codexToml, /sentry/u, "codex config should not have sentry");
    assert.match(codexToml, /playwright/u, "codex config should still have playwright");

    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(!claudeMcp.mcpServers.sentry, "claude MCP should not have sentry");
    assert.ok(claudeMcp.mcpServers.playwright, "claude MCP should still have playwright");

    // Security-audit skill outputs should be gone
    assert.ok(
      !(await fileExists(path.join(workspace, ".codex/skills/security-audit/SKILL.md"))),
      "codex security-audit skill pruned",
    );
    assert.ok(
      !(await fileExists(path.join(workspace, ".claude/skills/security-audit/SKILL.md"))),
      "claude security-audit skill pruned",
    );

    // Remaining outputs should still exist
    assert.ok(await fileExists(path.join(workspace, ".codex/skills/reviewer/SKILL.md")));
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")));
  });

  // ---- Phase 8: Disable a provider → apply → verify stale outputs -------
  test("phase 8 — disable copilot, apply removes copilot outputs", async () => {
    await runHarnessCli(workspace, ["provider", "disable", "copilot"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.ok(!manifest.providers.enabled.includes("copilot"));

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Copilot-specific outputs should be pruned
    const deleted = apply.data.result.prunedArtifacts;
    assert.ok(
      deleted.some((p) => p.includes(".github/")),
      "should prune copilot outputs",
    );

    assert.ok(!(await fileExists(path.join(workspace, ".github/copilot-instructions.md"))), "copilot prompt pruned");
    assert.ok(!(await fileExists(path.join(workspace, ".github/skills/reviewer/SKILL.md"))), "copilot skill pruned");

    // Other providers should still have outputs
    assert.ok(await fileExists(path.join(workspace, "AGENTS.md")), "codex prompt still exists");
    assert.ok(await fileExists(path.join(workspace, "CLAUDE.md")), "claude prompt still exists");
  });

  // ---- Phase 9: Re-enable copilot → apply → regenerated -----------------
  test("phase 9 — re-enable copilot, apply regenerates outputs", async () => {
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    const created = apply.data.result.operations.filter((op) => op.type === "create" && op.provider === "copilot");
    assert.ok(created.length > 0, "should create copilot outputs");

    assert.ok(await fileExists(path.join(workspace, ".github/copilot-instructions.md")), "copilot prompt regenerated");
    assert.ok(await fileExists(path.join(workspace, ".github/skills/reviewer/SKILL.md")), "copilot skill regenerated");
    assert.ok(await fileExists(path.join(workspace, ".vscode/mcp.json")), "copilot MCP regenerated");
  });

  // ---- Phase 10: Remove entity without --delete-source -------------------
  test("phase 10 — remove entity with --no-delete-source keeps source files", async () => {
    await runHarnessCli(workspace, ["remove", "hook", "notify-slack", "--no-delete-source"]);

    // Source file should still exist due to --no-delete-source
    assert.ok(
      await fileExists(path.join(workspace, ".harness/src/hooks/notify-slack.json")),
      "notify-slack source should persist with --no-delete-source",
    );

    // But manifest should not reference it
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.ok(!manifest.entities.some((e) => e.id === "notify-slack"));
  });

  // ---- Phase 11: Validate on healthy workspace --------------------------
  test("phase 11 — validate passes on healthy workspace (after cleaning orphan)", async () => {
    // The orphaned source file from phase 10 will cause SOURCE_UNREGISTERED.
    // Clean it up to test validate on a truly healthy workspace.
    await fs.rm(path.join(workspace, ".harness/src/hooks/notify-slack.json"), { force: true });
    // Also remove associated override files
    for (const provider of ["claude", "codex", "copilot"]) {
      await fs.rm(path.join(workspace, `.harness/src/hooks/notify-slack.overrides.${provider}.yaml`), { force: true });
    }

    const result = await runHarnessCli(workspace, ["validate", "--json"]);
    const validate = JSON.parse(result.stdout) as ValidateJsonOutput;

    assert.equal(validate.data.result.valid, true, `diagnostics: ${JSON.stringify(validate.data.result.diagnostics)}`);
    assert.equal(validate.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);
  });

  // ---- Phase 12: Doctor on healthy workspace -----------------------------
  test("phase 12 — doctor reports healthy workspace", async () => {
    const result = await runHarnessCli(workspace, ["doctor", "--json"]);
    const doctor = JSON.parse(result.stdout) as DoctorJsonOutput;

    assert.equal(doctor.data.result.healthy, true);
    assert.equal(doctor.data.result.migrationNeeded, false);
  });

  // ---- Phase 13: Plan shows only noop after final apply ------------------
  test("phase 13 — plan after final apply shows all noop", async () => {
    // Ensure outputs are current
    await runHarnessCli(workspace, ["apply"]);

    const result = await runHarnessCli(workspace, ["plan", "--json"]);
    const plan = JSON.parse(result.stdout) as PlanJsonOutput;

    assert.equal(plan.ok, true);
    const nonNoop = plan.data.result.operations.filter((op) => op.type !== "noop");
    assert.equal(nonNoop.length, 0, `expected all noop, got: ${JSON.stringify(nonNoop)}`);
  });

  // ---- Phase 14: Modify hook source → re-apply → verify hook update -----
  test("phase 14 — modify hook and re-apply updates hook outputs", async () => {
    // Change lint-guard to also handle post_tool_use
    await fs.writeFile(
      path.join(workspace, ".harness/src/hooks/lint-guard.json"),
      JSON.stringify(
        {
          mode: "best_effort",
          events: {
            pre_tool_use: [
              {
                type: "command",
                matcher: "Bash",
                command: "npm run lint -- --quiet",
                bash: "npm run lint -- --quiet",
                powershell: "npm run lint -- --quiet",
                timeoutSec: 30,
              },
            ],
            post_tool_use: [
              {
                type: "command",
                command: "npm run typecheck",
                bash: "npm run typecheck",
                powershell: "npx tsc --noEmit",
              },
            ],
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

    // Claude settings should now have both PreToolUse and PostToolUse
    const claudeSettings = await readWorkspaceJson<{
      hooks?: Record<string, unknown[]>;
    }>(workspace, ".claude/settings.json");
    assert.ok(claudeSettings.hooks?.PreToolUse, "claude should have PreToolUse");
    assert.ok(claudeSettings.hooks?.PostToolUse, "claude should have PostToolUse");

    // Copilot hook should have postToolUse but NOT preToolUse (matcher not supported, skipped in best_effort)
    const copilotHooks = await readWorkspaceJson<{
      hooks?: Record<string, unknown[]>;
    }>(workspace, ".github/hooks/harness.generated.json");
    assert.ok(!copilotHooks.hooks?.preToolUse, "copilot should skip preToolUse (matcher unsupported in best_effort)");
    assert.ok(copilotHooks.hooks?.postToolUse, "copilot should have postToolUse");
  });

  // ---- Phase 15: Multi-provider subagent override behaviour --------------
  test("phase 15 — subagent overrides render per-provider", async () => {
    // Claude override: specific model and tools
    await fs.writeFile(
      path.join(workspace, ".harness/src/subagents/researcher.overrides.claude.yaml"),
      "version: 1\noptions:\n  model: claude-sonnet-4-5\n  tools:\n    - bash\n    - web_search\n",
      "utf8",
    );

    // Codex override: different model
    await fs.writeFile(
      path.join(workspace, ".harness/src/subagents/researcher.overrides.codex.yaml"),
      "version: 1\noptions:\n  model: o3\n  tools:\n    - shell\n",
      "utf8",
    );

    // Copilot override: with handoffs
    await fs.writeFile(
      path.join(workspace, ".harness/src/subagents/researcher.overrides.copilot.yaml"),
      "version: 1\noptions:\n  model: gpt-5\n  tools:\n    - code_search\n  handoffs:\n    - planner\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Verify Claude subagent
    const claudeSubagent = await readWorkspaceText(workspace, ".claude/agents/researcher.md");
    assert.match(claudeSubagent, /model: "claude-sonnet-4-5"/u);
    assert.match(claudeSubagent, /tools: \["bash","web_search"\]/u);

    // Verify Codex config
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexToml, /model = "o3"/u);

    // Verify Copilot subagent
    const copilotSubagent = await readWorkspaceText(workspace, ".github/agents/researcher.agent.md");
    assert.match(copilotSubagent, /model: "gpt-5"/u);
    assert.match(copilotSubagent, /handoffs: \["planner"\]/u);
  });

  // ---- Phase 16: Final state consistency check ---------------------------
  test("phase 16 — final lock, managed index, and manifest are all consistent", async () => {
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    const managedIndex = await readWorkspaceJson<ManagedIndexJson>(workspace, ".harness/managed-index.json");

    // Lock entity count matches manifest entity count
    assert.equal(lock.entities.length, manifest.entities.length);

    // Every managed output path actually exists on disk
    for (const outputPath of managedIndex.managedOutputPaths) {
      assert.ok(await fileExists(path.join(workspace, outputPath)), `managed output should exist: ${outputPath}`);
    }

    // Every managed source path actually exists on disk
    for (const sourcePath of managedIndex.managedSourcePaths) {
      assert.ok(await fileExists(path.join(workspace, sourcePath)), `managed source should exist: ${sourcePath}`);
    }

    // Providers should be claude, codex, copilot
    assert.deepEqual([...manifest.providers.enabled].sort(), ["claude", "codex", "copilot"]);
  });
});
