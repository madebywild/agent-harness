/**
 * E2E User Journey: Registry-backed workflow with Gitea testcontainer
 *
 * Simulates a team setup where a central registry provides shared entities:
 *   init → add remote registry → set as default → add entities from registry
 *   → enable providers → apply → verify outputs match remote content
 *   → locally modify an imported entity → pull detects drift → force pull overwrites
 *   → remote registry updates → selective pull by --registry
 *   → add second registry → pull entities from multiple registries
 *   → remove remote entity → apply → verify cleanup
 *   → local overrides (targetPath, enabled=false) on remote entities
 *   → private registry with tokenEnvVar
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, describe, type TestContext, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "../cli-helpers.ts";
import { GiteaRegistryFixture, type RegistryRepoFixture } from "../gitea-registry-fixture.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManifestJson {
  version: number;
  providers: { enabled: string[] };
  registries: {
    default: string;
    entries: Record<string, { type: string; url?: string; ref?: string; tokenEnvVar?: string }>;
  };
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
  generatedAt: string;
  entities: Array<{
    type: string;
    id: string;
    registry: string;
    sourceSha256: string;
    importedSourceSha256?: string;
    registryRevision?: { kind: string; ref: string; commit: string };
  }>;
}

interface ApplyJsonOutput {
  ok: boolean;
  data: {
    result: {
      operations: Array<{ type: string; path: string; provider?: string }>;
      diagnostics: Array<{ code: string; severity: string; message: string }>;
      writtenArtifacts: string[];
      prunedArtifacts: string[];
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

function skipIfContainerRuntimeUnavailable(t: TestContext, reason: string | undefined): boolean {
  if (!reason) return false;
  t.skip(reason);
  return true;
}

function findMissingEnvVarName(prefix: string): string {
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = `${prefix}${process.pid}_${index}`;
    if (!(candidate in process.env)) return candidate;
  }
  throw new Error(`Could not allocate missing env var for prefix '${prefix}'`);
}

// ---------------------------------------------------------------------------
// Registry file builders
// ---------------------------------------------------------------------------
function buildRegistryManifest(title: string): string {
  return JSON.stringify({ version: 1, title, description: `${title} shared registry` }, null, 2);
}

function buildSkillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

function buildHookJson(mode: string, events: Record<string, unknown[]>): string {
  return JSON.stringify({ mode, events }, null, 2);
}

function buildMcpJson(servers: Record<string, unknown>): string {
  return JSON.stringify({ servers }, null, 2);
}

function buildSubagentFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const fixture = new GiteaRegistryFixture();
let unavailableReason: string | undefined;

before(async () => {
  try {
    await fixture.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Container runtime unavailable")) {
      unavailableReason = message;
      return;
    }
    throw error;
  }
});

after(async () => {
  await fixture.stop();
});

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------
describe("registry-backed workflow journey", { timeout: 300_000, concurrency: false }, () => {
  let workspace: string;
  let corpRepo: RegistryRepoFixture;
  let platformRepo: RegistryRepoFixture;

  // ---- Phase 1: Set up corp registry with all entity types ---------------
  test("phase 1 — create corp registry with shared entities", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    corpRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Corp Engineering"),
        "prompts/system.md": "You are a senior engineer at Acme Corp.\n\nFollow our internal coding standards.\n",
        "skills/reviewer/SKILL.md": buildSkillFile(
          "reviewer",
          "Corp code review standards",
          "# Corp Code Reviewer\n\nFollow our style guide and coverage requirements.",
        ),
        "skills/reviewer/style-guide.md": "- Use 2-space indentation\n- Prefer const over let\n- No any types\n",
        "mcp/playwright.json": buildMcpJson({
          playwright: { command: "npx", args: ["@anthropic-ai/playwright-mcp"] },
        }),
        "subagents/researcher.md": buildSubagentFile(
          "researcher",
          "Searches internal docs and web",
          "You are the Acme Corp research assistant.\n\nSearch our internal wiki and the web.",
        ),
        "hooks/ci-guard.json": buildHookJson("best_effort", {
          pre_tool_use: [
            {
              type: "command",
              matcher: "Bash",
              command: "npm run ci:check",
              bash: "npm run ci:check",
              powershell: "npm run ci:check",
            },
          ],
          turn_complete: [
            {
              type: "notify",
              command: ["python3", "scripts/corp-notify.py"],
            },
          ],
        }),
        "settings/codex.toml": 'model = "gpt-5.4"\n',
      },
      private: false,
      namePrefix: "corp",
    });
  });

  // ---- Phase 2: Init workspace and add corp registry as default ----------
  test("phase 2 — init and configure corp as default registry", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    workspace = await mkTmpRepo();
    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, [
      "registry",
      "add",
      "corp",
      "--git-url",
      corpRepo.readOnlyUrl,
      "--ref",
      corpRepo.defaultRef,
    ]);
    await runHarnessCli(workspace, ["registry", "default", "set", "corp"]);

    const defaultResult = await runHarnessCli(workspace, ["registry", "default", "show"]);
    assert.equal(defaultResult.stdout.trim(), "corp");

    // Verify registry in manifest
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.registries.entries.corp?.type, "git");
    assert.equal(manifest.registries.default, "corp");
  });

  // ---- Phase 3: Add all entity types from corp registry ------------------
  test("phase 3 — add entities from corp registry (uses default registry)", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Default registry is corp, so no --registry needed
    await runHarnessCli(workspace, ["add", "prompt"]);
    await runHarnessCli(workspace, ["add", "skill", "reviewer"]);
    await runHarnessCli(workspace, ["add", "mcp", "playwright"]);
    await runHarnessCli(workspace, ["add", "subagent", "researcher"]);
    await runHarnessCli(workspace, ["add", "hook", "ci-guard"]);
    await runHarnessCli(workspace, ["add", "settings", "codex"]);

    // Verify source content came from remote
    const prompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
    assert.match(prompt, /Acme Corp/u, "prompt should contain remote content");

    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /Corp Code Reviewer/u, "skill should contain remote content");

    // Verify multi-file skill
    assert.ok(
      await fileExists(path.join(workspace, ".harness/src/skills/reviewer/style-guide.md")),
      "multi-file skill should include style-guide.md",
    );

    const mcpSource = await readWorkspaceJson<{ servers: Record<string, unknown> }>(
      workspace,
      ".harness/src/mcp/playwright.json",
    );
    assert.ok(mcpSource.servers.playwright, "MCP should have playwright from remote");

    const subagent = await readWorkspaceText(workspace, ".harness/src/subagents/researcher.md");
    assert.match(subagent, /Acme Corp research assistant/u, "subagent should contain remote content");

    const hookSource = await readWorkspaceJson<{ mode: string; events: Record<string, unknown[]> }>(
      workspace,
      ".harness/src/hooks/ci-guard.json",
    );
    assert.equal(hookSource.mode, "best_effort");
    assert.ok(hookSource.events.pre_tool_use, "hook should have pre_tool_use from remote");
    assert.ok(hookSource.events.turn_complete, "hook should have turn_complete from remote");

    const settingsSource = await readWorkspaceText(workspace, ".harness/src/settings/codex.toml");
    assert.match(settingsSource, /gpt-5\.4/u, "codex settings should contain remote model");

    // All entities should be attributed to corp registry
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    for (const entity of manifest.entities) {
      assert.equal(entity.registry, "corp", `${entity.id} should be from corp registry`);
    }

    // Lock should record provenance
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    for (const entity of lock.entities) {
      assert.ok(entity.importedSourceSha256, `lock for ${entity.id} should have importedSourceSha256`);
      assert.ok(entity.registryRevision, `lock for ${entity.id} should have registryRevision`);
      assert.equal(entity.registryRevision?.kind, "git");
      assert.equal(entity.registryRevision?.ref, corpRepo.defaultRef);
      assert.ok(entity.registryRevision?.commit, `lock for ${entity.id} should have commit`);
    }
  });

  // ---- Phase 4: Enable providers and apply → verify remote content -------
  test("phase 4 — enable providers and apply generates outputs from remote content", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "codex"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Claude prompt should have Acme Corp content
    const claudePrompt = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.match(claudePrompt, /Acme Corp/u);

    // Codex prompt too
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    assert.match(codexPrompt, /Acme Corp/u);

    // Claude MCP should have playwright
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.playwright);

    // Claude subagent
    const claudeSubagent = await readWorkspaceText(workspace, ".claude/agents/researcher.md");
    assert.match(claudeSubagent, /Acme Corp research assistant/u);

    // Codex config should have notify from hook
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.match(codexToml, /notify/u);
    assert.match(codexToml, /corp-notify\.py/u);
    assert.match(codexToml, /gpt-5\.4/u);

    // Claude settings should have pre_tool_use hook
    const claudeSettings = await readWorkspaceJson<{ hooks?: Record<string, unknown[]> }>(
      workspace,
      ".claude/settings.json",
    );
    assert.ok(claudeSettings.hooks?.PreToolUse, "claude should render PreToolUse from ci-guard hook");
  });

  // ---- Phase 4b: Pull unchanged settings then apply remains lock-stable --
  test("phase 4b — unchanged settings pull keeps lock stable on apply", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["registry", "pull", "settings", "codex"]);
    const lockAfterPull = await readWorkspaceText(workspace, ".harness/manifest.lock.json");

    const applyResult = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(applyResult.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    const lockAfterApply = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
    assert.equal(lockAfterApply, lockAfterPull);
  });

  // ---- Phase 5: Local modification → pull detects drift ------------------
  test("phase 5 — local edit to imported entity triggers pull drift protection", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Locally modify the imported skill
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/reviewer/SKILL.md"),
      buildSkillFile("reviewer", "Locally customised reviewer", "# Local Custom Reviewer\n\nTeam-specific changes."),
      "utf8",
    );

    // Push an update to the remote
    await corpRepo.updateFile(
      "skills/reviewer/SKILL.md",
      buildSkillFile("reviewer", "Corp code review standards v2", "# Corp Code Reviewer v2\n\nUpdated standards."),
      "update reviewer v2",
    );

    // Pull should fail due to local drift
    const failed = await runHarnessCliExpectFailure(workspace, ["registry", "pull", "skill", "reviewer"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_PULL_CONFLICT/u);

    // Verify local content preserved
    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /Local Custom Reviewer/u, "local edit should be preserved");
  });

  // ---- Phase 6: Force pull overwrites local changes ----------------------
  test("phase 6 — force pull overwrites local changes with remote", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["registry", "pull", "skill", "reviewer", "--force"]);

    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /Corp Code Reviewer v2/u, "force pull should overwrite with remote v2");
    assert.doesNotMatch(skill, /Local Custom Reviewer/u, "local changes should be gone");
  });

  // ---- Phase 7: Add second registry, pull selectively --------------------
  test("phase 7 — add second registry, add entities, selective pull", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Create platform registry with different entities
    platformRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Platform"),
        "skills/deploy-helper/SKILL.md": buildSkillFile(
          "deploy-helper",
          "Assists with deployments",
          "# Deploy Helper\n\nHelp deploy to staging and production.",
        ),
        "mcp/datadog.json": buildMcpJson({
          datadog: { command: "npx", args: ["@datadog/mcp-server"], env: { DD_API_KEY: "key" } },
        }),
      },
      private: false,
      namePrefix: "platform",
    });

    await runHarnessCli(workspace, [
      "registry",
      "add",
      "platform",
      "--git-url",
      platformRepo.readOnlyUrl,
      "--ref",
      platformRepo.defaultRef,
    ]);

    // Add entities from platform registry
    await runHarnessCli(workspace, ["add", "skill", "deploy-helper", "--registry", "platform"]);
    await runHarnessCli(workspace, ["add", "mcp", "datadog", "--registry", "platform"]);

    // Verify entities are from correct registries
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const deploySkill = manifest.entities.find((e) => e.id === "deploy-helper");
    assert.equal(deploySkill?.registry, "platform");
    const datadogMcp = manifest.entities.find((e) => e.id === "datadog");
    assert.equal(datadogMcp?.registry, "platform");
    // Corp entities should still be from corp
    const reviewerSkill = manifest.entities.find((e) => e.id === "reviewer");
    assert.equal(reviewerSkill?.registry, "corp");

    // Apply to generate outputs
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Verify both MCP servers are in outputs
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.playwright, "playwright from corp");
    assert.ok(claudeMcp.mcpServers.datadog, "datadog from platform");
  });

  // ---- Phase 8: Selective pull by --registry -----------------------------
  test("phase 8 — update both registries, pull only corp", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Update both remotes
    await corpRepo.updateFile(
      "skills/reviewer/SKILL.md",
      buildSkillFile("reviewer", "Corp code review standards v3", "# Corp Code Reviewer v3\n\nThird version."),
      "update reviewer v3",
    );
    await platformRepo.updateFile(
      "skills/deploy-helper/SKILL.md",
      buildSkillFile("deploy-helper", "Deploy helper v2", "# Deploy Helper v2\n\nImproved deployment guidance."),
      "update deploy-helper v2",
    );

    // Pull only corp
    const pullResult = await runHarnessCli(workspace, ["registry", "pull", "--registry", "corp"]);
    assert.match(pullResult.stdout, /Pulled skill 'reviewer'\./u);

    // Corp skill updated
    const reviewer = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(reviewer, /Corp Code Reviewer v3/u);

    // Platform skill NOT updated
    const deployHelper = await readWorkspaceText(workspace, ".harness/src/skills/deploy-helper/SKILL.md");
    assert.doesNotMatch(deployHelper, /Deploy Helper v2/u, "platform skill should not be updated");
    assert.match(deployHelper, /Deploy Helper\b/u, "original platform skill content");
  });

  // ---- Phase 9: Now pull platform registry too ---------------------------
  test("phase 9 — pull platform registry updates platform entities", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["registry", "pull", "--registry", "platform"]);

    const deployHelper = await readWorkspaceText(workspace, ".harness/src/skills/deploy-helper/SKILL.md");
    assert.match(deployHelper, /Deploy Helper v2/u, "platform skill should now be updated");
  });

  // ---- Phase 10: Local override: disable entity for a provider -----------
  test("phase 10 — local override disables entity for specific provider", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Disable the datadog MCP for codex only
    await fs.writeFile(
      path.join(workspace, ".harness/src/mcp/datadog.overrides.codex.yaml"),
      "version: 1\nenabled: false\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Codex config should NOT have datadog
    const codexToml = await readWorkspaceText(workspace, ".codex/config.toml");
    assert.doesNotMatch(codexToml, /datadog/u, "codex should not have disabled datadog");
    assert.match(codexToml, /playwright/u, "codex should still have playwright");

    // Claude MCP should still have both
    const claudeMcp = await readWorkspaceJson<{ mcpServers: Record<string, unknown> }>(workspace, ".mcp.json");
    assert.ok(claudeMcp.mcpServers.datadog, "claude should still have datadog");
    assert.ok(claudeMcp.mcpServers.playwright, "claude should still have playwright");
  });

  // ---- Phase 11: Local override: custom targetPath -----------------------
  test("phase 11 — local override redirects prompt output to custom path", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Override prompt targetPath for claude
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompts/system.overrides.claude.yaml"),
      "version: 1\ntargetPath: docs/CLAUDE-PROMPT.md\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Custom path should exist with prompt content
    assert.ok(await fileExists(path.join(workspace, "docs/CLAUDE-PROMPT.md")), "custom claude prompt path");
    const customPrompt = await readWorkspaceText(workspace, "docs/CLAUDE-PROMPT.md");
    assert.match(customPrompt, /Acme Corp/u, "custom path has correct content");

    // Default CLAUDE.md should be pruned (it's now at the custom path)
    assert.ok(!(await fileExists(path.join(workspace, "CLAUDE.md"))), "default CLAUDE.md should be pruned");

    // Codex prompt should still be at default location
    assert.ok(await fileExists(path.join(workspace, "AGENTS.md")), "codex prompt unchanged");
  });

  // ---- Phase 12: Remove remote entity → apply → verify cleanup ----------
  test("phase 12 — remove imported entity and apply cleans up outputs", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Restore claude prompt to default for cleaner test
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompts/system.overrides.claude.yaml"),
      "version: 1\n",
      "utf8",
    );
    await runHarnessCli(workspace, ["apply"]);

    // Remove deploy-helper skill from platform (with source deletion)
    await runHarnessCli(workspace, ["remove", "skill", "deploy-helper"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.ok(!manifest.entities.some((e) => e.id === "deploy-helper"), "deploy-helper removed from manifest");

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    // Verify deploy-helper skill outputs are gone
    assert.ok(
      !(await fileExists(path.join(workspace, ".claude/skills/deploy-helper/SKILL.md"))),
      "claude deploy-helper pruned",
    );
    assert.ok(
      !(await fileExists(path.join(workspace, ".codex/skills/deploy-helper/SKILL.md"))),
      "codex deploy-helper pruned",
    );
  });

  // ---- Phase 13: Private registry with token authentication --------------
  test("phase 13 — private registry requires token, succeeds when provided", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    const privateRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Private Corp"),
        "skills/secret-skill/SKILL.md": buildSkillFile(
          "secret-skill",
          "Internal-only skill",
          "# Secret Skill\n\nThis is confidential.",
        ),
      },
      private: true,
      namePrefix: "private-corp",
    });

    const tokenEnvVar = findMissingEnvVarName("HARNESS_E2E_PRIVATE_TOKEN_");

    // Add private registry (on a fresh workspace for isolation)
    const privateWorkspace = await mkTmpRepo();
    await runHarnessCli(privateWorkspace, ["init"]);
    await runHarnessCli(privateWorkspace, [
      "registry",
      "add",
      "private-corp",
      "--git-url",
      privateRepo.readOnlyUrl,
      "--ref",
      privateRepo.defaultRef,
      "--token-env",
      tokenEnvVar,
    ]);

    // Attempt without token → fails
    const failed = await runHarnessCliExpectFailure(privateWorkspace, [
      "add",
      "skill",
      "secret-skill",
      "--registry",
      "private-corp",
    ]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_AUTH_MISSING/u);

    // Attempt with token → succeeds
    await runHarnessCli(privateWorkspace, ["add", "skill", "secret-skill", "--registry", "private-corp"], {
      env: { [tokenEnvVar]: fixture.getBasicAuthHeader() },
    });

    const skill = await readWorkspaceText(privateWorkspace, ".harness/src/skills/secret-skill/SKILL.md");
    assert.match(skill, /Secret Skill/u, "private skill fetched successfully");
    assert.match(skill, /confidential/u);
  });

  // ---- Phase 14: Mix of local and remote entities ------------------------
  test("phase 14 — local and remote entities coexist correctly", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Add a local-only skill (explicitly use local registry)
    await runHarnessCli(workspace, ["add", "skill", "team-onboarding", "--registry", "local"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const localSkill = manifest.entities.find((e) => e.id === "team-onboarding");
    assert.equal(localSkill?.registry, "local");

    // Corp entities should still be from corp
    const corpSkill = manifest.entities.find((e) => e.id === "reviewer");
    assert.equal(corpSkill?.registry, "corp");

    // Apply should work with mixed registries
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Both skills should have outputs
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")), "corp skill output");
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/team-onboarding/SKILL.md")), "local skill output");
  });

  // ---- Phase 15: Pull is no-op for local entities ------------------------
  test("phase 15 — pull skips local entities", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Edit the local skill
    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/team-onboarding/SKILL.md"),
      buildSkillFile("team-onboarding", "Team onboarding guide", "# Onboarding\n\nWelcome to the team."),
      "utf8",
    );

    // Pull should not touch local entities
    const pullResult = await runHarnessCli(workspace, ["registry", "pull"]);
    assert.doesNotMatch(pullResult.stdout, /team-onboarding/u, "local entity should not be pulled");

    // Local edits should persist
    const skill = await readWorkspaceText(workspace, ".harness/src/skills/team-onboarding/SKILL.md");
    assert.match(skill, /Welcome to the team/u);
  });

  // ---- Phase 16: Remove registry → must first remove its entities --------
  test("phase 16 — cannot remove registry with active entities, clean up first", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Attempt to remove platform registry while datadog MCP is still using it
    const failed = await runHarnessCliExpectFailure(workspace, ["registry", "remove", "platform"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /used by one or more entities/u);

    // Remove the entity first
    await runHarnessCli(workspace, ["remove", "mcp", "datadog"]);

    // Now removing platform registry should succeed
    await runHarnessCli(workspace, ["registry", "remove", "platform"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.ok(!manifest.registries.entries.platform, "platform registry removed");
  });

  // ---- Phase 17: Final consistency check ---------------------------------
  test("phase 17 — final workspace is consistent and healthy", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    // Apply to settle state
    const applyResult = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(applyResult.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    // Validate
    const validateResult = await runHarnessCli(workspace, ["validate", "--json"]);
    const validate = JSON.parse(validateResult.stdout) as { data: { result: { valid: boolean } } };
    assert.equal(validate.data.result.valid, true);

    // Doctor
    const doctorResult = await runHarnessCli(workspace, ["doctor", "--json"]);
    const doctor = JSON.parse(doctorResult.stdout) as { data: { result: { healthy: boolean } } };
    assert.equal(doctor.data.result.healthy, true);

    // Lock provenance is correct for remaining corp entities
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    const corpEntities = lock.entities.filter((e) => e.registry === "corp");
    for (const entity of corpEntities) {
      assert.ok(entity.registryRevision?.commit, `${entity.id} should have commit`);
      assert.equal(entity.registryRevision?.kind, "git");
    }

    // Local entities should not have registry provenance
    const localEntities = lock.entities.filter((e) => e.registry === "local");
    for (const entity of localEntities) {
      assert.ok(!entity.registryRevision, `local entity ${entity.id} should not have registryRevision`);
    }
  });
});
