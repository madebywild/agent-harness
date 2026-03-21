import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { buildClaudeAdapter } from "../src/provider-adapters/claude.ts";
import { buildCodexAdapter } from "../src/provider-adapters/codex.ts";
import { buildCopilotAdapter } from "../src/provider-adapters/copilot.ts";
import type { CanonicalCommand } from "../src/types.ts";
import { mkTmpRepo } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Claude renderCommand
// ---------------------------------------------------------------------------

test("claude renderCommand emits .claude/commands/<id>.md", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = {
    id: "fix-issue",
    description: "Fix the described issue",
    body: "Fix $ARGUMENTS now.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.path, ".claude/commands/fix-issue.md");
  assert.equal(artifacts[0]?.provider, "claude");
  assert.equal(artifacts[0]?.format, "markdown");
});

test("claude renderCommand includes description in frontmatter", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My command description",
    body: "Do the thing.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(content.includes('description: "My command description"'), `content was:\n${content}`);
});

test("claude renderCommand includes argument-hint when present", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My command",
    argumentHint: "[file-path]",
    body: "Work on $ARGUMENTS.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(content.includes('argument-hint: "[file-path]"'), `content was:\n${content}`);
});

test("claude renderCommand omits argument-hint when not present", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My command",
    body: "Do it.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(!content.includes("argument-hint"), `content was:\n${content}`);
});

test("claude renderCommand returns empty when override.enabled is false", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = { id: "cmd", description: "My command", body: "Do it." };

  const artifacts = await adapter.renderCommand!(input, { version: 1, enabled: false });

  assert.equal(artifacts.length, 0);
});

test("claude renderCommand respects custom targetPath override", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = { id: "cmd", description: "My command", body: "Do it." };

  const artifacts = await adapter.renderCommand!(input, { version: 1, targetPath: ".claude/custom/my-cmd.md" });

  assert.equal(artifacts[0]?.path, ".claude/custom/my-cmd.md");
});

test("claude renderCommand ends with single trailing newline", async () => {
  const adapter = buildClaudeAdapter(new Map());
  const input: CanonicalCommand = { id: "cmd", description: "My command", body: "Do it." };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(content.endsWith("\n"), "content should end with newline");
  assert.ok(!content.endsWith("\n\n"), "content should not end with double newline");
});

// ---------------------------------------------------------------------------
// Copilot renderCommand
// ---------------------------------------------------------------------------

test("copilot renderCommand emits .github/prompts/<id>.prompt.md", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = {
    id: "fix-issue",
    description: "Fix the described issue",
    body: "Fix $ARGUMENTS.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.path, ".github/prompts/fix-issue.prompt.md");
  assert.equal(artifacts[0]?.provider, "copilot");
  assert.equal(artifacts[0]?.format, "markdown");
});

test("copilot renderCommand includes mode: agent in frontmatter", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My command description",
    body: "Do it.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(content.includes("mode: agent"), `content was:\n${content}`);
});

test("copilot renderCommand includes description in frontmatter", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My copilot description",
    body: "Do it.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(content.includes('description: "My copilot description"'), `content was:\n${content}`);
});

test("copilot renderCommand does not include argument-hint", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = {
    id: "cmd",
    description: "My command",
    argumentHint: "[arg]",
    body: "Do it.",
  };

  const artifacts = await adapter.renderCommand!(input, undefined);
  const content = artifacts[0]?.content ?? "";

  assert.ok(!content.includes("argument-hint"), `content was:\n${content}`);
});

test("copilot renderCommand returns empty when override.enabled is false", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = { id: "cmd", description: "My command", body: "Do it." };

  const artifacts = await adapter.renderCommand!(input, { version: 1, enabled: false });

  assert.equal(artifacts.length, 0);
});

test("copilot renderCommand respects custom targetPath override", async () => {
  const adapter = buildCopilotAdapter(new Map());
  const input: CanonicalCommand = { id: "cmd", description: "My command", body: "Do it." };

  const artifacts = await adapter.renderCommand!(input, { version: 1, targetPath: ".github/custom/cmd.prompt.md" });

  assert.equal(artifacts[0]?.path, ".github/custom/cmd.prompt.md");
});

// ---------------------------------------------------------------------------
// Codex — no renderCommand
// ---------------------------------------------------------------------------

test("codex adapter has no renderCommand method", () => {
  const adapter = buildCodexAdapter(new Map());
  assert.equal(adapter.renderCommand, undefined);
});

// ---------------------------------------------------------------------------
// Integration: apply produces command artifacts
// ---------------------------------------------------------------------------

test("apply with claude+copilot produces command output files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addCommand("fix-issue");
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");

  // Write valid source
  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.md"),
    '---\ndescription: "Fix the described issue"\n---\n\nPlease fix: $ARGUMENTS\n',
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((d) => d.severity === "error"),
    false,
    `Unexpected errors: ${JSON.stringify(apply.diagnostics)}`,
  );

  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".claude/commands/fix-issue.md")));
  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".github/prompts/fix-issue.prompt.md")));
});

test("apply with codex only produces no command output files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addCommand("fix-issue");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.md"),
    '---\ndescription: "Fix the described issue"\n---\n\nFix it.\n',
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((d) => d.severity === "error"),
    false,
    `Unexpected errors: ${JSON.stringify(apply.diagnostics)}`,
  );

  await assert.rejects(() => fs.stat(path.join(cwd, ".claude/commands/fix-issue.md")));
  await assert.rejects(() => fs.stat(path.join(cwd, ".github/prompts/fix-issue.prompt.md")));
});

test("apply command with override enabled=false for claude skips claude output", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addCommand("fix-issue");
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.md"),
    '---\ndescription: "Fix the described issue"\n---\n\nFix it.\n',
    "utf8",
  );

  // Disable claude for this command
  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.overrides.claude.yaml"),
    "version: 1\nenabled: false\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((d) => d.severity === "error"),
    false,
    `Unexpected errors: ${JSON.stringify(apply.diagnostics)}`,
  );

  await assert.rejects(() => fs.stat(path.join(cwd, ".claude/commands/fix-issue.md")));
  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".github/prompts/fix-issue.prompt.md")));
});

test("apply command with custom copilot targetPath uses custom path", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addCommand("fix-issue");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.md"),
    '---\ndescription: "Fix the described issue"\n---\n\nFix it.\n',
    "utf8",
  );

  // Set custom target path
  await fs.writeFile(
    path.join(cwd, ".harness/src/commands/fix-issue.overrides.copilot.yaml"),
    "version: 1\ntargetPath: .github/prompts/custom/my-fix.prompt.md\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((d) => d.severity === "error"),
    false,
    `Unexpected errors: ${JSON.stringify(apply.diagnostics)}`,
  );

  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".github/prompts/custom/my-fix.prompt.md")));
  await assert.rejects(() => fs.stat(path.join(cwd, ".github/prompts/fix-issue.prompt.md")));
});

test("apply command with missing description emits COMMAND_DESCRIPTION_MISSING diagnostic", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addCommand("bad-cmd");
  await engine.enableProvider("claude");

  // Write invalid source (no description)
  await fs.writeFile(path.join(cwd, ".harness/src/commands/bad-cmd.md"), "Just body, no frontmatter.\n", "utf8");

  const apply = await engine.apply();
  assert.ok(
    apply.diagnostics.some((d) => d.code === "COMMAND_DESCRIPTION_MISSING"),
    `Expected COMMAND_DESCRIPTION_MISSING, got: ${JSON.stringify(apply.diagnostics)}`,
  );
});
