import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { detectLegacyAssets, runUHaulInitFlow } from "../src/u-haul.ts";
import { mkTmpRepo } from "./helpers.ts";

const execFileAsync = promisify(execFile);

async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd });
}

test("detectLegacyAssets identifies default legacy paths", async () => {
  const cwd = await mkTmpRepo();
  await fs.writeFile(path.join(cwd, "AGENTS.md"), "# Prompt\n", "utf8");
  await fs.mkdir(path.join(cwd, ".claude/skills/reviewer"), { recursive: true });
  await fs.writeFile(path.join(cwd, ".claude/skills/reviewer/SKILL.md"), "# reviewer\n", "utf8");

  const detected = await detectLegacyAssets(cwd);

  assert.equal(detected.hasLegacyAssets, true);
  assert.ok(detected.paths.includes("AGENTS.md"));
  assert.ok(detected.paths.includes(".claude/skills"));
  assert.deepEqual(detected.providers, ["claude", "codex"]);
});

test("runUHaulInitFlow imports all entity families, deletes legacy paths, enables providers, and applies", async () => {
  const cwd = await mkTmpRepo();
  await initGitRepo(cwd);

  await fs.writeFile(path.join(cwd, "AGENTS.md"), "# Codex Prompt\n\nUse codex tone.\n", "utf8");

  await fs.mkdir(path.join(cwd, ".claude/skills/reviewer"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude/skills/reviewer/SKILL.md"),
    "---\nname: reviewer\ndescription: Review skill\n---\n\n# reviewer\n",
    "utf8",
  );

  await fs.writeFile(
    path.join(cwd, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          browser: {
            command: "npx",
            args: ["@modelcontextprotocol/server-browser"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.mkdir(path.join(cwd, ".claude/agents"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude/agents/planner.md"),
    "---\nname: planner\ndescription: Plan tasks\n---\n\nPlan work in small steps.\n",
    "utf8",
  );

  await fs.mkdir(path.join(cwd, ".claude/commands"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude/commands/fix.md"),
    '---\ndescription: "Fix an issue"\n---\n\nFix: $ARGUMENTS\n',
    "utf8",
  );

  await fs.writeFile(
    path.join(cwd, ".claude/settings.json"),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo checking",
                },
              ],
            },
          ],
        },
        telemetry: {
          enabled: true,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.mkdir(path.join(cwd, ".vscode"), { recursive: true });
  await fs.writeFile(path.join(cwd, ".vscode/settings.json"), JSON.stringify({ "editor.tabSize": 2 }, null, 2), "utf8");

  const summary = await runUHaulInitFlow({ cwd, force: false });

  assert.equal(summary.detected.prompt, 1);
  assert.equal(summary.detected.skill, 1);
  assert.equal(summary.detected.mcp, 1);
  assert.equal(summary.detected.subagent, 1);
  assert.equal(summary.detected.hook, 1);
  assert.equal(summary.detected.settings, 2);
  assert.equal(summary.detected.command, 1);
  assert.deepEqual(summary.autoEnabledProviders, ["claude", "codex", "copilot"]);
  assert.ok(summary.apply.operations >= 0);

  assert.deepEqual(summary.deletedLegacyPaths, [
    ".claude/agents",
    ".claude/commands",
    ".claude/settings.json",
    ".claude/skills",
    ".mcp.json",
    ".vscode/settings.json",
    "AGENTS.md",
  ]);

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/mcp/browser.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/subagents/planner.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/hooks/pre_tool_use.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/settings/claude.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/settings/copilot.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands/fix.md")));

  await assert.rejects(async () => fs.stat(path.join(cwd, "AGENTS.md")), /ENOENT/u);
  await assert.rejects(async () => fs.stat(path.join(cwd, ".claude/skills")), /ENOENT/u);
});

test("runUHaulInitFlow resolves prompt conflicts by default precedence and supports precedence override", async () => {
  const cwdDefault = await mkTmpRepo();
  await initGitRepo(cwdDefault);
  await fs.writeFile(path.join(cwdDefault, "AGENTS.md"), "Codex prompt\n", "utf8");
  await fs.writeFile(path.join(cwdDefault, "CLAUDE.md"), "Claude prompt\n", "utf8");

  const defaultSummary = await runUHaulInitFlow({ cwd: cwdDefault, force: false });
  const defaultPrompt = await fs.readFile(path.join(cwdDefault, ".harness/src/prompts/system.md"), "utf8");
  assert.equal(defaultSummary.precedence[0], "claude");
  assert.equal(defaultPrompt.trim(), "Claude prompt");
  assert.ok(
    defaultSummary.precedenceDrops.some(
      (drop) =>
        drop.entityType === "prompt" &&
        drop.id === "system" &&
        drop.keptProvider === "claude" &&
        drop.droppedProvider === "codex",
    ),
  );

  const cwdOverride = await mkTmpRepo();
  await initGitRepo(cwdOverride);
  await fs.writeFile(path.join(cwdOverride, "AGENTS.md"), "Codex prompt\n", "utf8");
  await fs.writeFile(path.join(cwdOverride, "CLAUDE.md"), "Claude prompt\n", "utf8");

  const overrideSummary = await runUHaulInitFlow({ cwd: cwdOverride, force: false, precedencePrimary: "codex" });
  const overridePrompt = await fs.readFile(path.join(cwdOverride, ".harness/src/prompts/system.md"), "utf8");
  assert.equal(overrideSummary.precedence[0], "codex");
  assert.equal(overridePrompt.trim(), "Codex prompt");
});

test("runUHaulInitFlow applies deterministic collision suffixing including -<n>", async () => {
  const cwd = await mkTmpRepo();
  await initGitRepo(cwd);

  await fs.mkdir(path.join(cwd, ".claude/skills/foo"), { recursive: true });
  await fs.writeFile(path.join(cwd, ".claude/skills/foo/SKILL.md"), "# foo\n", "utf8");

  await fs.mkdir(path.join(cwd, ".claude/agents"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude/agents/foo-command.md"),
    "---\nname: foo-command\ndescription: existing id\n---\n\nagent body\n",
    "utf8",
  );

  await fs.mkdir(path.join(cwd, ".claude/commands"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".claude/commands/foo.md"),
    '---\ndescription: "Foo command"\n---\n\nBody\n',
    "utf8",
  );

  const summary = await runUHaulInitFlow({ cwd, force: false });

  assert.ok(
    summary.collisionRemaps.some(
      (remap) => remap.entityType === "command" && remap.fromId === "foo" && remap.toId === "foo-command-2",
    ),
  );
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/commands/foo-command-2.md")));
});

test("runUHaulInitFlow enforces git safety gate before deletion", async () => {
  const cwd = await mkTmpRepo();
  await fs.writeFile(path.join(cwd, "AGENTS.md"), "Prompt\n", "utf8");

  await assert.rejects(() => runUHaulInitFlow({ cwd, force: false }), /U_HAUL_GIT_WORKTREE_REQUIRED/u);
});

test("runUHaulInitFlow aborts on parse failure before init/deletion", async () => {
  const cwd = await mkTmpRepo();
  await initGitRepo(cwd);

  await fs.mkdir(path.join(cwd, ".claude/commands"), { recursive: true });
  await fs.writeFile(path.join(cwd, ".claude/commands/bad.md"), "This file has no command description\n", "utf8");

  await assert.rejects(() => runUHaulInitFlow({ cwd, force: false }), /U_HAUL_PARSE_FAILED/u);

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".claude/commands/bad.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".harness")), /ENOENT/u);
});

test("runUHaulInitFlow returns no-op summary when no legacy assets are present", async () => {
  const cwd = await mkTmpRepo();
  await initGitRepo(cwd);

  const summary = await runUHaulInitFlow({ cwd, force: false });

  assert.equal(summary.noOp, true);
  assert.equal(summary.detected.prompt, 0);
  assert.equal(summary.detected.skill, 0);
  assert.equal(summary.detected.mcp, 0);
  assert.equal(summary.detected.subagent, 0);
  assert.equal(summary.detected.hook, 0);
  assert.equal(summary.detected.settings, 0);
  assert.equal(summary.detected.command, 0);
  assert.deepEqual(summary.deletedLegacyPaths, []);
});
