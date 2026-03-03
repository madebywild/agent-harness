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
  assert.match(tomlContent, /experimental_use_role = true/u);
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
