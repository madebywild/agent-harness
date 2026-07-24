/**
 * E2E User Journey: monorepo `target` co-location
 *
 * Drives the real CLI through the monorepo feature:
 *   init → enable claude/codex/copilot → add a root prompt plus targeted
 *   prompt/skill/mcp/hook → apply → verify capability-aware placement
 *   (Claude + Codex nest, Copilot routes to root, prompt singleton skip)
 *   → retarget a skill → verify prune + recreate
 *   → PROMPT_TARGET_CONFLICT and SETTINGS_TARGET_UNSUPPORTED guardrails
 *   → separate workspace: targeting the only prompt still feeds Copilot's root file
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "../cli-helpers.ts";

interface Diagnostic {
  code: string;
  severity: string;
  provider?: string;
  entityId?: string;
}

interface ApplyJsonOutput {
  ok: boolean;
  data: {
    result: {
      operations: Array<{ type: string; path: string; provider?: string }>;
      diagnostics: Diagnostic[];
      writtenArtifacts: string[];
      prunedArtifacts: string[];
    };
  };
}

interface ManifestJson {
  entities: Array<{ type: string; id: string; target?: string; [key: string]: unknown }>;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function patchManifest(workspace: string, mutate: (manifest: ManifestJson) => void): Promise<void> {
  const manifestPath = path.join(workspace, ".harness/manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ManifestJson;
  mutate(manifest);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("monorepo target journey", { timeout: 180_000 }, () => {
  let workspace: string;

  // ---- Phase 1: init + enable every provider ----------------------------
  test("phase 1 — init and enable claude, codex, copilot", async () => {
    workspace = await mkTmpRepo();
    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "codex"]);
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);
  });

  // ---- Phase 2: add a root prompt plus targeted entities ----------------
  test("phase 2 — add root prompt and per-package targeted entities", async () => {
    await runHarnessCli(workspace, ["add", "prompt-section", "system"]); // system, root
    await runHarnessCli(workspace, ["add", "prompt-section", "web", "--target", "packages/web"]);
    await runHarnessCli(workspace, ["add", "skill", "api-testing", "--target", "packages/api"]);
    await runHarnessCli(workspace, ["add", "mcp", "web-mcp", "--target", "packages/web"]);
    await runHarnessCli(workspace, ["add", "hook", "guard", "--target", "packages/web"]);

    // Canonical sources stay central regardless of target.
    for (const source of [
      ".harness/src/prompt-sections/system/SECTION.md",
      ".harness/src/prompt-sections/web/SECTION.md",
      ".harness/src/skills/api-testing/SKILL.md",
      ".harness/src/mcp/web-mcp.json",
      ".harness/src/hooks/guard.json",
    ]) {
      assert.ok(await fileExists(path.join(workspace, source)), `expected central source: ${source}`);
    }

    // Targets are persisted on the entities.
    const manifest = JSON.parse(
      await fs.readFile(path.join(workspace, ".harness/manifest.json"), "utf8"),
    ) as ManifestJson;
    assert.equal(manifest.entities.find((e) => e.id === "web" && e.type === "prompt_section")?.target, "packages/web");
    assert.equal(manifest.entities.find((e) => e.id === "api-testing")?.target, "packages/api");
    assert.equal(manifest.entities.find((e) => e.id === "system")?.target, undefined);
  });

  // ---- Phase 3: apply → capability-aware placement ----------------------
  test("phase 3 — apply co-locates for Claude/Codex and routes to root for Copilot", async () => {
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);
    assert.equal(
      apply.data.result.diagnostics.filter((d) => d.severity === "error").length,
      0,
      `unexpected errors: ${apply.data.result.diagnostics.map((d) => d.code).join(", ")}`,
    );

    // Claude nests everything it was given a target for.
    assert.ok(await fileExists(path.join(workspace, "CLAUDE.md")), "root system prompt (claude)");
    assert.ok(await fileExists(path.join(workspace, "packages/web/CLAUDE.md")), "web prompt nested (claude)");
    assert.ok(
      await fileExists(path.join(workspace, "packages/api/.claude/skills/api-testing/SKILL.md")),
      "skill nested (claude)",
    );
    assert.ok(await fileExists(path.join(workspace, "packages/web/.mcp.json")), "mcp nested (claude)");
    assert.ok(
      await fileExists(path.join(workspace, "packages/web/.claude/settings.json")),
      "hook nested into settings.json (claude)",
    );
    // Claude MCP was targeted, so there is no root .mcp.json.
    assert.ok(!(await fileExists(path.join(workspace, ".mcp.json"))), "no root .mcp.json (was targeted)");

    // Codex nests the prompt (AGENTS.md); its config.toml is root-only.
    assert.ok(await fileExists(path.join(workspace, "AGENTS.md")), "root system prompt (codex)");
    assert.ok(await fileExists(path.join(workspace, "packages/web/AGENTS.md")), "web prompt nested (codex)");
    assert.ok(await fileExists(path.join(workspace, ".codex/skills/api-testing/SKILL.md")), "codex skill at root");
    assert.ok(await fileExists(path.join(workspace, ".codex/config.toml")), "codex config at root");
    assert.ok(!(await fileExists(path.join(workspace, "packages/web/.codex/config.toml"))), "no nested codex config");

    // Copilot never nests: skill routes to root, and every prompt-section composes into the single
    // instructions file (the targeted `web` section is routed to root for copilot).
    assert.ok(await fileExists(path.join(workspace, ".github/skills/api-testing/SKILL.md")), "copilot skill at root");
    assert.ok(
      await fileExists(path.join(workspace, ".github/copilot-instructions.md")),
      "copilot instructions at root",
    );
    assert.ok(
      !(await fileExists(path.join(workspace, "packages/api/.github/skills/api-testing/SKILL.md"))),
      "copilot skill NOT nested",
    );
    assert.ok(
      !(await fileExists(path.join(workspace, "packages/web/.github/copilot-instructions.md"))),
      "copilot prompt NOT nested",
    );

    // Diagnostics reflect the routing.
    const diags = apply.data.result.diagnostics;
    assert.ok(
      diags.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.severity === "info"),
      "expected TARGET_ROUTED_TO_ROOT info",
    );
    assert.ok(
      diags.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "copilot" && d.entityId === "web"),
      "expected TARGET_ROUTED_TO_ROOT for copilot/web",
    );
  });

  // ---- Phase 4: retarget a skill → prune old, create new ----------------
  test("phase 4 — retargeting a skill prunes the old output and writes the new one", async () => {
    await patchManifest(workspace, (manifest) => {
      const skill = manifest.entities.find((e) => e.type === "skill" && e.id === "api-testing");
      if (skill) {
        skill.target = "packages/lib";
      }
    });

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    assert.ok(
      await fileExists(path.join(workspace, "packages/lib/.claude/skills/api-testing/SKILL.md")),
      "skill at new target",
    );
    assert.ok(
      !(await fileExists(path.join(workspace, "packages/api/.claude/skills/api-testing/SKILL.md"))),
      "old target pruned",
    );
  });

  // ---- Phase 5: a second untargeted prompt-section composes (no conflict) ---
  test("phase 5 — a second untargeted prompt-section composes into the root file", async () => {
    await runHarnessCli(workspace, ["add", "prompt-section", "dupe"]); // untargeted -> composes with system at root

    const result = await runHarnessCli(workspace, ["plan", "--json"]);
    const plan = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.ok(!plan.data.result.diagnostics.some((d) => d.severity === "error"));

    // Clean up so later phases operate on the original workspace shape.
    await runHarnessCli(workspace, ["remove", "prompt-section", "dupe"]);
  });

  // ---- Phase 6: SETTINGS_TARGET_UNSUPPORTED guardrail -------------------
  test("phase 6 — target on a settings entity is a blocking error", async () => {
    await runHarnessCli(workspace, ["add", "settings", "claude"]);
    await patchManifest(workspace, (manifest) => {
      const settings = manifest.entities.find((e) => e.type === "settings");
      if (settings) {
        settings.target = "packages/web";
      }
    });

    const failed = await runHarnessCliExpectFailure(workspace, ["apply", "--json"]);
    const apply = JSON.parse(failed.stdout) as ApplyJsonOutput;
    assert.ok(apply.data.result.diagnostics.some((d) => d.code === "SETTINGS_TARGET_UNSUPPORTED"));
    assert.equal(apply.data.result.writtenArtifacts.length, 0);
  });
});

describe("monorepo target — only prompt targeted", { timeout: 120_000 }, () => {
  // The footgun case: if the sole prompt is targeted, a non-nesting provider must still get its
  // root instructions file (the targeted prompt wins the root slot rather than being skipped).
  test("targeting the only prompt still gives Copilot its root instructions", async () => {
    const workspace = await mkTmpRepo();
    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);
    await runHarnessCli(workspace, ["add", "prompt-section", "system", "--target", "packages/web"]);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJsonOutput;
    assert.equal(apply.ok, true);

    assert.ok(await fileExists(path.join(workspace, "packages/web/CLAUDE.md")), "claude nests it");
    assert.ok(
      await fileExists(path.join(workspace, ".github/copilot-instructions.md")),
      "copilot still gets a root instructions file",
    );

    const copilot = await readWorkspaceText(workspace, ".github/copilot-instructions.md");
    assert.ok(copilot.length > 0, "copilot instructions are non-empty");
  });
});
