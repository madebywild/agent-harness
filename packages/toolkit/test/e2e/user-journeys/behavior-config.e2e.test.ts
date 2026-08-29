/**
 * E2E User Journey: behavior config
 *
 * Covers:
 *   behavior map + placeholder → apply resolves the map default
 *   behavior show (default vs config source)
 *   behavior set → apply switches the rendered instruction
 *   behavior set with an invalid value fails naming the allowed values
 *   unknown config key → validate reports BEHAVIOR_KEY_UNKNOWN and apply refuses
 *   unknown placeholder key → apply succeeds with a warning, placeholder stays literal
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import { initGitRepo, mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "../cli-helpers.ts";

const execFileAsync = promisify(execFile);

interface BehaviorShowJson {
  ok: boolean;
  data: {
    entries: Array<{ key: string; value: string; source: string; allowed: string[]; instruction: string }>;
  };
}

interface ApplyJson {
  ok: boolean;
  data: { result: { diagnostics: Array<{ code: string; severity: string }> } };
}

interface ValidateJson {
  ok: boolean;
  data: { result: { valid: boolean; diagnostics: Array<{ code: string; severity: string }> } };
}

const MAP_YAML = [
  "version: 1",
  "keys:",
  "  effort:",
  "    description: How much validation to run per iteration",
  "    default: thorough",
  "    values:",
  "      fast: |",
  "        Skip broad tests and linting until the user requests a merge into main.",
  "      thorough: |",
  "        Run the full test and lint suite after every change.",
  "",
].join("\n");

describe("behavior config journey", { timeout: 120_000 }, () => {
  let workspace: string;

  test("phase 1 — init, enable claude, add prompt-section with a behavior placeholder", async () => {
    workspace = await mkTmpRepo();

    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["add", "prompt-section", "system"]);

    await fs.writeFile(
      path.join(workspace, ".harness/src/prompt-sections/system/SECTION.md"),
      "# Working agreement\n\nEffort policy:\n\n{{behavior.effort}}\n",
      "utf8",
    );
    await fs.writeFile(path.join(workspace, ".harness/behavior.map.yaml"), MAP_YAML, "utf8");
  });

  test("phase 2 — apply resolves the map default into CLAUDE.md", async () => {
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJson;
    assert.equal(apply.ok, true, `apply failed: ${result.stdout}`);

    const output = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.ok(output.includes("Run the full test and lint suite"), "default instruction should be rendered");
    assert.ok(!output.includes("{{behavior."), "no raw placeholder should remain");
  });

  test("phase 3 — behavior show reports the default choice", async () => {
    const result = await runHarnessCli(workspace, ["behavior", "show", "--json"]);
    const show = JSON.parse(result.stdout) as BehaviorShowJson;
    assert.equal(show.ok, true);
    assert.deepEqual(show.data.entries, [
      {
        key: "effort",
        value: "thorough",
        source: "default",
        allowed: ["fast", "thorough"],
        instruction: "Run the full test and lint suite after every change.\n",
      },
    ]);
  });

  test("phase 4 — behavior set writes the local config and apply renders the choice", async () => {
    await runHarnessCli(workspace, ["behavior", "set", "effort", "fast", "--json"]);

    const config = await readWorkspaceText(workspace, ".harness/behavior.yaml");
    assert.ok(config.includes("effort: fast"), `config should record the choice, got: ${config}`);

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJson;
    assert.equal(apply.ok, true, `apply failed: ${result.stdout}`);

    const output = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.ok(output.includes("Skip broad tests and linting"), "configured instruction should be rendered");

    const show = JSON.parse(
      (await runHarnessCli(workspace, ["behavior", "show", "--json"])).stdout,
    ) as BehaviorShowJson;
    assert.equal(show.data.entries[0]?.source, "config");
    assert.equal(show.data.entries[0]?.value, "fast");
  });

  test("phase 5 — behavior set rejects a value outside the map", async () => {
    const failure = await runHarnessCliExpectFailure(workspace, ["behavior", "set", "effort", "turbo"]);
    assert.ok(
      failure.stderr.includes("Allowed values: fast, thorough"),
      `error should name allowed values, got: ${failure.stderr}`,
    );
  });

  test("phase 6 — unknown config key fails validate and blocks apply", async () => {
    await fs.writeFile(path.join(workspace, ".harness/behavior.yaml"), "speed: fast\n", "utf8");

    const failure = await runHarnessCliExpectFailure(workspace, ["validate", "--json"]);
    const validate = JSON.parse(failure.stdout) as ValidateJson;
    assert.equal(validate.data.result.valid, false);
    assert.ok(validate.data.result.diagnostics.some((d) => d.code === "BEHAVIOR_KEY_UNKNOWN"));

    const applyFailure = await runHarnessCliExpectFailure(workspace, ["apply", "--json"]);
    const apply = JSON.parse(applyFailure.stdout) as ApplyJson;
    assert.equal(apply.ok, false, "apply must refuse with behavior errors");

    // Restore a valid config for the next phase.
    await fs.writeFile(path.join(workspace, ".harness/behavior.yaml"), "effort: fast\n", "utf8");
  });

  test("phase 7 — unknown placeholder key warns and stays literal", async () => {
    await fs.writeFile(
      path.join(workspace, ".harness/src/prompt-sections/system/SECTION.md"),
      "Effort policy:\n\n{{behavior.effort}}\n\nTone policy:\n\n{{behavior.tone}}\n",
      "utf8",
    );

    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const apply = JSON.parse(result.stdout) as ApplyJson;
    assert.equal(apply.ok, true, `apply should succeed with a warning: ${result.stdout}`);
    assert.ok(
      apply.data.result.diagnostics.some(
        (d) => d.code === "BEHAVIOR_PLACEHOLDER_UNRESOLVED" && d.severity === "warning",
      ),
    );

    const output = await readWorkspaceText(workspace, "CLAUDE.md");
    assert.ok(output.includes("{{behavior.tone}}"), "unknown placeholder should remain literal");
    assert.ok(output.includes("Skip broad tests and linting"), "known placeholder should still resolve");
  });

  test("phase 8 — the shipped .harness/.gitignore keeps local choices out of git", async () => {
    const repo = await mkTmpRepo();
    await initGitRepo(repo);

    await runHarnessCli(repo, ["init"]);
    await fs.writeFile(path.join(repo, ".harness/behavior.map.yaml"), MAP_YAML, "utf8");
    await runHarnessCli(repo, ["behavior", "set", "effort", "fast"]);
    await fs.writeFile(path.join(repo, ".harness/.env"), "API_KEY=secret\n", "utf8");

    // The consuming project never touched its own .gitignore.
    assert.equal(
      await fs
        .stat(path.join(repo, ".gitignore"))
        .then(() => true)
        .catch(() => false),
      false,
      "no root .gitignore should be required",
    );

    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo });
    const tracked = stdout.split("\n").filter(Boolean);
    assert.ok(
      !tracked.some((line) => line.includes(".harness/behavior.yaml")),
      `behavior.yaml should be ignored, got: ${stdout}`,
    );
    assert.ok(!tracked.some((line) => line.includes(".harness/.env")), `.env should be ignored, got: ${stdout}`);
    assert.ok(
      tracked.some((line) => line.includes(".harness/behavior.map.yaml")),
      "the shared behavior map must stay visible to git",
    );
    assert.ok(
      tracked.some((line) => line.includes(".harness/.gitignore")),
      "the ignore file itself must be committable",
    );
  });
});
