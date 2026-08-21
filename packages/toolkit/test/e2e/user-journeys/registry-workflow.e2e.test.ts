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

  const CORP_PRESET = "corp-stack";

  // ---- Phase 1: corp registry (categorized skills + prompt-sections + a preset embedding
  // every non-registry-sourceable entity type). Strict root: only skills/, prompt-sections/,
  // presets/ live at the registry root. -----------------------------------
  test("phase 1 — create corp registry with categorized skills, prompt-sections, and a stack preset", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    corpRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Corp Engineering"),
        "prompt-sections/misc/system/SECTION.md":
          "---\nname: system\ndescription: Corp base prompt\ntags: [corp]\n---\n\nYou are a senior engineer at Acme Corp.\n\nFollow our internal coding standards.\n",
        "skills/engineering/reviewer/SKILL.md": buildSkillFile(
          "reviewer",
          "Corp code review standards",
          "# Corp Code Reviewer\n\nFollow our style guide and coverage requirements.",
        ),
        "skills/engineering/reviewer/style-guide.md":
          "- Use 2-space indentation\n- Prefer const over let\n- No any types\n",
        // Non-registry-sourceable entity types are delivered through a preset that embeds them.
        "presets/corp-stack/preset.json": JSON.stringify(
          {
            id: CORP_PRESET,
            name: "Corp Stack",
            description: "Corp toolchain: embedded mcp, subagent, hook, settings, and command.",
            operations: [
              { type: "enable_provider", provider: "claude" },
              { type: "enable_provider", provider: "codex" },
              { type: "add_mcp", id: "playwright" },
              { type: "add_subagent", id: "researcher" },
              { type: "add_hook", id: "ci-guard" },
              { type: "add_settings", provider: "codex" },
              { type: "add_command", id: "review" },
            ],
          },
          null,
          2,
        ),
        "presets/corp-stack/mcp/playwright.json": buildMcpJson({
          playwright: { command: "npx", args: ["@anthropic-ai/playwright-mcp"] },
        }),
        "presets/corp-stack/subagents/researcher.md": buildSubagentFile(
          "researcher",
          "Searches internal docs and web",
          "You are the Acme Corp research assistant.\n\nSearch our internal wiki and the web.",
        ),
        "presets/corp-stack/hooks/ci-guard.json": buildHookJson("best_effort", {
          pre_tool_use: [
            {
              type: "command",
              matcher: "Bash",
              command: "npm run ci:check",
              bash: "npm run ci:check",
              powershell: "npm run ci:check",
            },
          ],
          turn_complete: [{ type: "notify", command: ["python3", "scripts/corp-notify.py"] }],
        }),
        "presets/corp-stack/settings/codex.toml": 'model = "gpt-5.4"\n',
        "presets/corp-stack/commands/review.md":
          "---\ndescription: Review staged changes\n---\n\n# review\n\nReview the diff and summarize findings.\n",
      },
      private: false,
      namePrefix: "corp",
    });
  });

  // ---- Phase 2: init workspace and add corp registry as default ----------
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

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.equal(manifest.registries.entries.corp?.type, "git");
    assert.equal(manifest.registries.default, "corp");
  });

  // ---- Phase 3: add registry-sourceable entities (skill + prompt-section) by bare id -----
  test("phase 3 — add skill and prompt-section from corp registry with provenance", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["add", "prompt-section", "system"]);
    await runHarnessCli(workspace, ["add", "skill", "reviewer"]);

    const prompt = await readWorkspaceText(workspace, ".harness/src/prompt-sections/system/SECTION.md");
    assert.match(prompt, /Acme Corp/u);

    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /Corp Code Reviewer/u);
    assert.ok(
      await fileExists(path.join(workspace, ".harness/src/skills/reviewer/style-guide.md")),
      "multi-file skill should include style-guide.md",
    );

    // Both are attributed to corp with git provenance.
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    for (const id of ["system", "reviewer"]) {
      const entity = lock.entities.find((e) => e.id === id);
      assert.ok(entity?.importedSourceSha256, `lock for ${id} should have importedSourceSha256`);
      assert.equal(entity?.registryRevision?.kind, "git");
      assert.equal(entity?.registryRevision?.ref, corpRepo.defaultRef);
      assert.ok(entity?.registryRevision?.commit);
    }
  });

  // ---- Phase 4: preset apply delivers embedded non-sourceable entities; apply generates outputs
  test("phase 4 — apply corp-stack preset and generate provider outputs", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["preset", "apply", CORP_PRESET, "--registry", "corp"]);

    // Embedded entities materialize locally (no registry provenance).
    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    for (const id of ["playwright", "researcher", "ci-guard", "review"]) {
      const entity = manifest.entities.find((e) => e.id === id);
      assert.ok(entity, `${id} should be materialized`);
      assert.equal(entity?.registry, "local", `${id} embedded from preset should be local`);
    }
    const subagent = await readWorkspaceText(workspace, ".harness/src/subagents/researcher.md");
    assert.match(subagent, /Acme Corp research assistant/u);
    const settings = await readWorkspaceText(workspace, ".harness/src/settings/codex.toml");
    assert.match(settings, /gpt-5\.4/u);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    const claudePrompt = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.match(claudePrompt, /Acme Corp/u);
    const codexPrompt = await readWorkspaceText(workspace, "AGENTS.md");
    assert.match(codexPrompt, /Acme Corp/u);
    assert.ok(await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")), "reviewer skill output");
  });

  // ---- Phase 5: local edit to an imported skill triggers pull drift protection -----------
  test("phase 5 — local edit to imported skill triggers pull drift protection", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await fs.writeFile(
      path.join(workspace, ".harness/src/skills/reviewer/SKILL.md"),
      buildSkillFile("reviewer", "Corp code review standards", "# Locally edited reviewer"),
      "utf8",
    );

    const failed = await runHarnessCliExpectFailure(workspace, ["registry", "pull", "skill", "reviewer"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_PULL_CONFLICT/u);
  });

  // ---- Phase 6: force pull overwrites local changes with remote --------------------------
  test("phase 6 — force pull overwrites local changes with remote", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await corpRepo.updateFile(
      "skills/engineering/reviewer/SKILL.md",
      buildSkillFile("reviewer", "Corp code review standards", "# Corp Code Reviewer v2"),
      "update reviewer",
    );

    await runHarnessCli(workspace, ["registry", "pull", "skill", "reviewer", "--force"]);
    const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    assert.match(skill, /Corp Code Reviewer v2/u);
  });

  // ---- Phase 7: second registry, selective pull by --registry ----------------------------
  test("phase 7 — add platform registry and selectively pull only corp", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    platformRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Platform"),
        "skills/ops/deployer/SKILL.md": buildSkillFile("deployer", "Deploy helper", "# Deployer v1"),
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
    await runHarnessCli(workspace, ["add", "skill", "deployer", "--registry", "platform"]);

    await corpRepo.updateFile(
      "skills/engineering/reviewer/SKILL.md",
      buildSkillFile("reviewer", "Corp code review standards", "# Corp Code Reviewer v3"),
      "update reviewer again",
    );
    await platformRepo.updateFile(
      "skills/ops/deployer/SKILL.md",
      buildSkillFile("deployer", "Deploy helper", "# Deployer v2"),
      "update deployer",
    );

    const pullResult = await runHarnessCli(workspace, ["registry", "pull", "--registry", "corp"]);
    assert.match(pullResult.stdout, /Pulled skill 'reviewer'\./u);
    assert.doesNotMatch(pullResult.stdout, /Pulled skill 'deployer'\./u);

    const reviewer = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
    const deployer = await readWorkspaceText(workspace, ".harness/src/skills/deployer/SKILL.md");
    assert.match(reviewer, /Corp Code Reviewer v3/u);
    assert.match(deployer, /Deployer v1/u, "platform skill untouched by corp-only pull");
  });

  // ---- Phase 8: private registry requires a token ----------------------------------------
  test("phase 8 — private registry requires token, succeeds when provided", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    const privateRepo = await fixture.createRegistryRepo({
      files: {
        "harness-registry.json": buildRegistryManifest("Private Corp"),
        "skills/misc/secret-skill/SKILL.md": buildSkillFile(
          "secret-skill",
          "Internal-only skill",
          "# Secret Skill\n\nThis is confidential.",
        ),
      },
      private: true,
      namePrefix: "private-corp",
    });

    const tokenEnvVar = findMissingEnvVarName("HARNESS_E2E_PRIVATE_TOKEN_");
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

    const failed = await runHarnessCliExpectFailure(privateWorkspace, [
      "add",
      "skill",
      "secret-skill",
      "--registry",
      "private-corp",
    ]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_AUTH_MISSING/u);

    await runHarnessCli(privateWorkspace, ["add", "skill", "secret-skill", "--registry", "private-corp"], {
      env: { [tokenEnvVar]: fixture.getBasicAuthHeader() },
    });
    const skill = await readWorkspaceText(privateWorkspace, ".harness/src/skills/secret-skill/SKILL.md");
    assert.match(skill, /confidential/u);
  });

  // ---- Phase 9: remove an imported entity and apply cleans up outputs --------------------
  test("phase 9 — remove imported skill and apply cleans up outputs", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["remove", "skill", "reviewer"]);
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(
      await fileExists(path.join(workspace, ".claude/skills/reviewer/SKILL.md")),
      false,
      "reviewer output pruned",
    );
  });

  // ---- Phase 10: registry cannot be removed while entities reference it -------------------
  test("phase 10 — cannot remove registry with active entities, clean up first", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    const failed = await runHarnessCliExpectFailure(workspace, ["registry", "remove", "platform"]);
    assert.equal(failed.code, 1);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /used by one or more entities/u);

    await runHarnessCli(workspace, ["remove", "skill", "deployer"]);
    await runHarnessCli(workspace, ["registry", "remove", "platform"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    assert.ok(!manifest.registries.entries.platform, "platform registry removed");
  });

  // ---- Phase 11: final workspace is consistent and healthy -------------------------------
  test("phase 11 — final workspace is consistent and healthy", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    const applyResult = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(applyResult.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(apply.data.result.diagnostics.filter((d) => d.severity === "error").length, 0);

    const validateResult = await runHarnessCli(workspace, ["validate", "--json"]);
    const validate = JSON.parse(validateResult.stdout) as { data: { result: { valid: boolean } } };
    assert.equal(validate.data.result.valid, true);

    const doctorResult = await runHarnessCli(workspace, ["doctor", "--json"]);
    const doctor = JSON.parse(doctorResult.stdout) as { data: { result: { healthy: boolean } } };
    assert.equal(doctor.data.result.healthy, true);

    // Remaining corp entity (prompt-section) keeps its git provenance.
    const lock = await readWorkspaceJson<LockJson>(workspace, ".harness/manifest.lock.json");
    const corpEntities = lock.entities.filter((e) => e.registry === "corp");
    assert.ok(corpEntities.length > 0);
    for (const entity of corpEntities) {
      assert.equal(entity.registryRevision?.kind, "git");
      assert.ok(entity.registryRevision?.commit);
    }
  });
});
