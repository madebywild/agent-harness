import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

test("apply warns when entities exist but no providers are enabled", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();

  const apply = await engine.apply();
  assert.equal(apply.writtenArtifacts.length, 0);
  assert.equal(apply.prunedArtifacts.length, 0);
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "NO_PROVIDERS_ENABLED"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );
});

test("provider enablement controls generated outputs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");
  await engine.enableProvider("codex");

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, "AGENTS.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/config.toml")));

  await assert.rejects(async () => fs.stat(path.join(cwd, "CLAUDE.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".github/copilot-instructions.md")));
});

test("claude provider generates correct output files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/playwright.json"),
    JSON.stringify(
      {
        servers: {
          playwright: {
            command: "npx",
            args: ["@anthropic-ai/playwright-mcp"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, "CLAUDE.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".claude/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".mcp.json")));

  const mcpContent = await fs.readFile(path.join(cwd, ".mcp.json"), "utf8");
  const mcpConfig = JSON.parse(mcpContent) as {
    mcpServers: Record<string, unknown>;
  };
  assert.ok(mcpConfig.mcpServers, "MCP config should have mcpServers property");
  assert.ok(mcpConfig.mcpServers.playwright, "MCP config should have playwright server");

  await assert.rejects(async () => fs.stat(path.join(cwd, "AGENTS.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".github/copilot-instructions.md")));
});

test("copilot provider generates correct output files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/playwright.json"),
    JSON.stringify(
      {
        servers: {
          playwright: {
            command: "npx",
            args: ["@anthropic-ai/playwright-mcp"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".github/copilot-instructions.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".github/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".vscode/mcp.json")));

  const mcpContent = await fs.readFile(path.join(cwd, ".vscode/mcp.json"), "utf8");
  const mcpConfig = JSON.parse(mcpContent) as {
    servers: Record<string, unknown>;
  };
  assert.ok(mcpConfig.servers, "MCP config should have servers property");
  assert.ok(!("mcpServers" in mcpConfig), "MCP config should NOT have mcpServers property");
  assert.ok(mcpConfig.servers.playwright, "MCP config should have playwright server");

  await assert.rejects(async () => fs.stat(path.join(cwd, "AGENTS.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, "CLAUDE.md")));
});

test("cursor provider generates only supported native outputs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("reviewer");
  await engine.addMcp("playwright");
  await engine.addSubagent("researcher");
  await engine.addHook("guard");
  await engine.addCommand("fix-issue");
  await engine.addSettings("cursor");
  await engine.enableProvider("cursor");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/playwright.json"),
    JSON.stringify(
      {
        servers: {
          playwright: {
            command: "npx",
            args: ["@modelcontextprotocol/server-playwright"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/cursor.json"),
    JSON.stringify(
      {
        "cursor.experimental": true,
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(apply.diagnostics),
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".cursor/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".cursor/mcp.json")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".cursor/agents/researcher.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".cursor/hooks.json")));

  await assert.rejects(async () => fs.stat(path.join(cwd, ".cursor/prompt.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".cursor/commands/fix-issue.md")));
  await assert.rejects(async () => fs.stat(path.join(cwd, ".cursor/settings.json")));
});

test("multiple providers generate all expected outputs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSkill("shared-skill");
  await engine.addMcp("test-server");
  await engine.enableProvider("codex");
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/test-server.json"),
    JSON.stringify(
      {
        servers: {
          test: {
            command: "node",
            args: ["server.js"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, "AGENTS.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/skills/shared-skill/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/config.toml")));

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, "CLAUDE.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".claude/skills/shared-skill/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".mcp.json")));

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".github/copilot-instructions.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".github/skills/shared-skill/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".vscode/mcp.json")));
});

test("codex MCP config uses TOML format with mcp_servers property", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("test-server");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/test-server.json"),
    JSON.stringify(
      {
        servers: {
          test: {
            command: "node",
            args: ["server.js"],
            env: { KEY: "value" },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const tomlContent = await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8");
  assert.ok(tomlContent.includes("[mcp_servers.test]"), "TOML should have [mcp_servers.test] server section");
  assert.ok(tomlContent.includes('command = "node"'), "TOML should include command");
  assert.ok(!tomlContent.includes("[mcp_servers]\n"), "TOML should NOT have bare [mcp_servers] header");
});

test("claude subagent renders frontmatter and body", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("researcher");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/researcher.overrides.claude.yaml"),
    "version: 1\noptions:\n  model: claude-sonnet-4-5\n  tools:\n    - bash\n    - web_search\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const rendered = await fs.readFile(path.join(cwd, ".claude/agents/researcher.md"), "utf8");
  assert.match(rendered, /name: "researcher"/u);
  assert.match(rendered, /description: "Describe what this subagent does\."/u);
  assert.match(rendered, /model: "claude-sonnet-4-5"/u);
  assert.match(rendered, /tools: \["bash","web_search"\]/u);
  assert.match(rendered, /You are the researcher subagent\./u);
});

test("copilot subagent renders .agent.md with handoffs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("reviewer");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/reviewer.overrides.copilot.yaml"),
    "version: 1\noptions:\n  model: gpt-5\n  tools:\n    - code_search\n  handoffs:\n    - planner\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const rendered = await fs.readFile(path.join(cwd, ".github/agents/reviewer.agent.md"), "utf8");
  assert.match(rendered, /name: "reviewer"/u);
  assert.match(rendered, /model: "gpt-5"/u);
  assert.match(rendered, /tools: \["code_search"\]/u);
  assert.match(rendered, /handoffs: \["planner"\]/u);
});

test("cursor subagent uses override options first, then canonical metadata", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("validator");
  await engine.enableProvider("cursor");

  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/validator.md"),
    [
      "---",
      "name: validator",
      "description: Validates work completion.",
      "model: gpt-5-mini",
      "readonly: true",
      "is_background: false",
      "---",
      "",
      "You validate implementation details.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/validator.overrides.cursor.yaml"),
    "version: 1\noptions:\n  model: gpt-5\n  is_background: true\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(apply.diagnostics),
  );

  const rendered = await fs.readFile(path.join(cwd, ".cursor/agents/validator.md"), "utf8");
  assert.match(rendered, /name: "validator"/u);
  assert.match(rendered, /description: "Validates work completion\."/u);
  assert.match(rendered, /model: "gpt-5"/u);
  assert.match(rendered, /readonly: true/u);
  assert.match(rendered, /is_background: true/u);
});

test("codex merges MCP and subagents into shared config", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("test-server");
  await engine.addSubagent("researcher");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/test-server.json"),
    JSON.stringify(
      {
        servers: {
          test: {
            command: "node",
            args: ["server.js"],
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/researcher.overrides.codex.yaml"),
    "version: 1\noptions:\n  model: gpt-5\n  tools:\n    - web_search\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const tomlContent = await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8");
  assert.match(tomlContent, /\[mcp_servers\.test\]/u);
  assert.match(tomlContent, /\[agents\.researcher\]/u);
  assert.match(tomlContent, /model = "gpt-5"/u);
  assert.match(tomlContent, /tools = \[\s*"web_search"\s*\]/u);
});

test("codex shared config target conflict reports CODEX_CONFIG_TARGET_CONFLICT", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("test-server");
  await engine.addSubagent("researcher");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/test-server.overrides.codex.yaml"),
    "version: 1\ntargetPath: .codex/mcp.toml\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/researcher.overrides.codex.yaml"),
    "version: 1\ntargetPath: .codex/agents.toml\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "CODEX_CONFIG_TARGET_CONFLICT"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

test("unknown subagent override option emits warning and is ignored", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("researcher");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/researcher.overrides.claude.yaml"),
    "version: 1\noptions:\n  model: claude-sonnet-4-5\n  unsupported: true\n",
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "SUBAGENT_OPTIONS_UNKNOWN"));

  const rendered = await fs.readFile(path.join(cwd, ".claude/agents/researcher.md"), "utf8");
  assert.doesNotMatch(rendered, /unsupported/u);
});

test("claude provider renders hook settings from hook entities", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          pre_tool_use: [
            {
              type: "command",
              matcher: "Bash",
              command: "echo claude-hook",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const rendered = JSON.parse(await fs.readFile(path.join(cwd, ".claude/settings.json"), "utf8")) as {
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  };
  assert.ok(rendered.hooks?.PreToolUse);
  assert.equal(rendered.hooks?.PreToolUse?.[0]?.matcher, "Bash");
  assert.equal(
    (rendered.hooks?.PreToolUse?.[0]?.hooks?.[0] as { command?: string } | undefined)?.command,
    "echo claude-hook",
  );
});

test("copilot provider renders hook configuration from hook entities", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          pre_tool_use: [
            {
              type: "command",
              bash: "echo pre-tool",
              powershell: "Write-Output pre-tool",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const rendered = JSON.parse(await fs.readFile(path.join(cwd, ".github/hooks/harness.generated.json"), "utf8")) as {
    version?: number;
    hooks?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.equal(rendered.version, 1);
  assert.ok(rendered.hooks?.preToolUse);
  assert.equal(rendered.hooks?.preToolUse?.[0]?.type, "command");
});

test("cursor provider renders hooks.json with canonical event mapping", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("cursor");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          pre_tool_use: [
            {
              type: "command",
              command: "echo pre-tool",
              matcher: "Bash",
              timeoutSec: 12,
            },
          ],
          prompt_submit: [
            {
              type: "command",
              command: "echo prompt-submit",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(apply.diagnostics),
  );

  const rendered = JSON.parse(await fs.readFile(path.join(cwd, ".cursor/hooks.json"), "utf8")) as {
    version?: number;
    hooks?: Record<string, Array<Record<string, unknown>>>;
  };
  assert.equal(rendered.version, 1);
  assert.ok(rendered.hooks?.preToolUse);
  assert.ok(rendered.hooks?.beforeSubmitPrompt);
  assert.equal(rendered.hooks?.preToolUse?.[0]?.command, "echo pre-tool");
  assert.equal(rendered.hooks?.preToolUse?.[0]?.matcher, "Bash");
  assert.equal(rendered.hooks?.preToolUse?.[0]?.timeout, 12);
});

test("cursor hooks strict mode rejects unsupported command fields, best_effort skips", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("strict-hook");
  await engine.addHook("best-hook");
  await engine.enableProvider("cursor");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/strict-hook.json"),
    JSON.stringify({
      mode: "strict",
      events: {
        pre_tool_use: [{ type: "command", command: "echo strict", cwd: ".harness" }],
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/best-hook.json"),
    JSON.stringify({
      mode: "best_effort",
      events: {
        post_tool_use: [{ type: "command", command: "echo best", env: { FOO: "bar" } }],
      },
    }),
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_EVENT_UNSUPPORTED"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

test("codex provider maps turn_complete hook to notify command", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          turn_complete: [
            {
              type: "notify",
              command: ["python3", "scripts/on_turn_complete.py"],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );

  const tomlContent = await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8");
  assert.match(tomlContent, /notify = \[\s*"python3",\s*"scripts\/on_turn_complete\.py"\s*\]/u);
});

test("codex provider accepts default scaffolded hook without edits", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("codex");

  const hookSource = JSON.parse(await fs.readFile(path.join(cwd, ".harness/src/hooks/guard.json"), "utf8")) as {
    mode?: string;
  };
  assert.equal(hookSource.mode, "best_effort");

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );
});

test("codex provider rejects notify arrays with non-string entries", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          turn_complete: [
            {
              type: "notify",
              command: ["python3", 123, "scripts/on_turn_complete.py"],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_NOTIFY_COMMAND_INVALID"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

test("codex provider rejects unsupported hook events in strict mode", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          pre_tool_use: [
            {
              type: "command",
              command: "echo should-fail-on-codex",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_EVENT_UNSUPPORTED"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

test("best_effort mode skips unsupported events without errors on claude and codex", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("multi");
  await engine.enableProvider("claude");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/multi.json"),
    JSON.stringify(
      {
        mode: "best_effort",
        events: {
          turn_complete: [
            {
              type: "notify",
              command: ["python3", "scripts/notify.py"],
            },
          ],
          pre_tool_use: [
            {
              type: "command",
              command: "echo pre-tool",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const apply = await engine.apply();
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    `unexpected errors: ${apply.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.code)
      .join(", ")}`,
  );

  // Claude renders pre_tool_use but skips turn_complete
  const claudeSettings = JSON.parse(await fs.readFile(path.join(cwd, ".claude/settings.json"), "utf8")) as {
    hooks?: Record<string, unknown>;
  };
  assert.ok(claudeSettings.hooks?.PreToolUse, "Claude should render PreToolUse");

  // Codex renders turn_complete as notify but skips pre_tool_use
  const tomlContent = await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8");
  assert.match(tomlContent, /notify/u, "Codex should render notify");
});

test("hook target path conflict fails with HOOK_TARGET_CONFLICT", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("hook-a");
  await engine.addHook("hook-b");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-a.json"),
    JSON.stringify({
      mode: "strict",
      events: { pre_tool_use: [{ type: "command", bash: "echo a", powershell: "echo a" }] },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-b.json"),
    JSON.stringify({
      mode: "strict",
      events: { pre_tool_use: [{ type: "command", bash: "echo b", powershell: "echo b" }] },
    }),
    "utf8",
  );

  // Override hook-a and hook-b to different target paths
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-a.overrides.copilot.yaml"),
    'version: 1\ntargetPath: ".github/hooks/a.json"\n',
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-b.overrides.copilot.yaml"),
    'version: 1\ntargetPath: ".github/hooks/b.json"\n',
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_TARGET_CONFLICT"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});

test("codex rejects conflicting notify commands with HOOK_NOTIFY_CONFLICT", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("hook-a");
  await engine.addHook("hook-b");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-a.json"),
    JSON.stringify({
      mode: "strict",
      events: {
        turn_complete: [{ type: "notify", command: ["python3", "scripts/a.py"] }],
      },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/hook-b.json"),
    JSON.stringify({
      mode: "strict",
      events: {
        turn_complete: [{ type: "notify", command: ["python3", "scripts/b.py"] }],
      },
    }),
    "utf8",
  );

  const apply = await engine.apply();
  assert.ok(apply.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_NOTIFY_CONFLICT"));
  assert.equal(
    apply.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    true,
  );
});
