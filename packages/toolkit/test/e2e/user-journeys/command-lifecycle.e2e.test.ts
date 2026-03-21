/**
 * E2E User Journey: command entity lifecycle
 *
 * Covers:
 *   add command → apply → verify outputs
 *   remove command → apply → verify pruning
 *   multiple commands
 *   provider override — disable for Claude
 *   custom targetPath override for Copilot
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli } from "../cli-helpers.ts";

interface ManifestJson {
  entities: Array<{ type: string; id: string; registry: string; sourcePath: string }>;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

describe("command lifecycle journey", { timeout: 120_000 }, () => {
  let workspace: string;

  // ---- Phase 1: Setup workspace ------------------------------------------
  test("phase 1 — init and enable providers", async () => {
    workspace = await mkTmpRepo();

    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);
    // codex enabled to verify it produces no command output
    await runHarnessCli(workspace, ["provider", "enable", "codex"]);

    assert.ok(await fileExists(path.join(workspace, ".harness/manifest.json")));
  });

  // ---- Phase 2: Add a command and apply ----------------------------------
  test("phase 2 — add command and apply produces provider outputs", async () => {
    await runHarnessCli(workspace, ["add", "command", "fix-issue"]);

    assert.ok(await fileExists(path.join(workspace, ".harness/src/commands/fix-issue.md")), "expected source file");

    // Update with valid description + body
    await fs.writeFile(
      path.join(workspace, ".harness/src/commands/fix-issue.md"),
      '---\ndescription: "Fix the issue described in the arguments"\nargument-hint: "[issue-number]"\n---\n\nFix the issue: $ARGUMENTS\n',
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as { ok: boolean; data: { result: { diagnostics: unknown[] } } };
    assert.equal(apply.ok, true, `apply failed: ${result.stdout}`);

    // Claude output
    assert.ok(
      await fileExists(path.join(workspace, ".claude/commands/fix-issue.md")),
      "expected .claude/commands/fix-issue.md",
    );
    const claudeContent = await readWorkspaceText(workspace, ".claude/commands/fix-issue.md");
    assert.ok(claudeContent.includes('description: "Fix the issue described in the arguments"'));
    assert.ok(claudeContent.includes('argument-hint: "[issue-number]"'));
    assert.ok(claudeContent.includes("Fix the issue: $ARGUMENTS"));

    // Copilot output
    assert.ok(
      await fileExists(path.join(workspace, ".github/prompts/fix-issue.prompt.md")),
      "expected .github/prompts/fix-issue.prompt.md",
    );
    const copilotContent = await readWorkspaceText(workspace, ".github/prompts/fix-issue.prompt.md");
    assert.ok(copilotContent.includes("mode: agent"));
    assert.ok(copilotContent.includes('description: "Fix the issue described in the arguments"'));
    assert.ok(!copilotContent.includes("argument-hint"), "copilot should not have argument-hint");
    assert.ok(copilotContent.includes("Fix the issue: $ARGUMENTS"));

    // Codex — no command output
    assert.equal(
      await fileExists(path.join(workspace, ".codex/commands/fix-issue.md")),
      false,
      "codex should not produce command output",
    );
  });

  // ---- Phase 3: Multiple commands ----------------------------------------
  test("phase 3 — add second command, both commands have outputs after apply", async () => {
    await runHarnessCli(workspace, ["add", "command", "run-tests"]);

    await fs.writeFile(
      path.join(workspace, ".harness/src/commands/run-tests.md"),
      '---\ndescription: "Run the test suite"\n---\n\nRun all tests now.\n',
      "utf8",
    );

    await runHarnessCli(workspace, ["apply"]);

    assert.ok(await fileExists(path.join(workspace, ".claude/commands/fix-issue.md")));
    assert.ok(await fileExists(path.join(workspace, ".claude/commands/run-tests.md")));
    assert.ok(await fileExists(path.join(workspace, ".github/prompts/fix-issue.prompt.md")));
    assert.ok(await fileExists(path.join(workspace, ".github/prompts/run-tests.prompt.md")));

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const commandEntities = manifest.entities.filter((e) => e.type === "command");
    assert.equal(commandEntities.length, 2);
  });

  // ---- Phase 4: Disable for Claude via override --------------------------
  test("phase 4 — override enabled=false for claude removes claude output", async () => {
    await fs.writeFile(
      path.join(workspace, ".harness/src/commands/run-tests.overrides.claude.yaml"),
      "version: 1\nenabled: false\n",
      "utf8",
    );

    await runHarnessCli(workspace, ["apply"]);

    // run-tests: claude disabled, copilot still present
    assert.equal(
      await fileExists(path.join(workspace, ".claude/commands/run-tests.md")),
      false,
      "run-tests claude output should be gone after disabling",
    );
    assert.ok(
      await fileExists(path.join(workspace, ".github/prompts/run-tests.prompt.md")),
      "run-tests copilot output should remain",
    );

    // fix-issue: unchanged
    assert.ok(await fileExists(path.join(workspace, ".claude/commands/fix-issue.md")));
  });

  // ---- Phase 5: Custom targetPath for copilot ----------------------------
  test("phase 5 — custom copilot targetPath override uses custom path", async () => {
    await fs.writeFile(
      path.join(workspace, ".harness/src/commands/fix-issue.overrides.copilot.yaml"),
      "version: 1\ntargetPath: .github/prompts/custom/fix-issue.prompt.md\n",
      "utf8",
    );

    await runHarnessCli(workspace, ["apply"]);

    // custom path present
    assert.ok(
      await fileExists(path.join(workspace, ".github/prompts/custom/fix-issue.prompt.md")),
      "expected artifact at custom copilot path",
    );
    // default path gone
    assert.equal(
      await fileExists(path.join(workspace, ".github/prompts/fix-issue.prompt.md")),
      false,
      "default copilot path should be pruned after custom override",
    );
  });

  // ---- Phase 6: Remove a command ----------------------------------------
  test("phase 6 — remove command prunes all its output files", async () => {
    // Now remove fix-issue
    await runHarnessCli(workspace, ["remove", "command", "fix-issue"]);
    await runHarnessCli(workspace, ["apply"]);

    assert.equal(await fileExists(path.join(workspace, ".claude/commands/fix-issue.md")), false);
    // The custom path was pruned too when it was the active output, but now after restore+remove,
    // the default path should also be gone
    assert.equal(await fileExists(path.join(workspace, ".github/prompts/fix-issue.prompt.md")), false);
    assert.equal(
      await fileExists(path.join(workspace, ".github/prompts/custom/fix-issue.prompt.md")),
      false,
      "custom copilot path should be gone after remove",
    );

    // run-tests still present
    assert.ok(await fileExists(path.join(workspace, ".github/prompts/run-tests.prompt.md")));

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");
    const commandEntities = manifest.entities.filter((e) => e.type === "command");
    assert.equal(commandEntities.length, 1);
    assert.equal(commandEntities[0]?.id, "run-tests");
  });
});
