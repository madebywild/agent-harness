import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

// ---------------------------------------------------------------------------
// 1. Prompt with env vars
// ---------------------------------------------------------------------------

test("env integration: prompt placeholders are substituted from .harness/.env", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  // Overwrite the prompt source with a placeholder
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.md"),
    "You are a {{ROLE}} assistant for {{PROJECT_NAME}}.\n",
  );

  // Create .harness/.env with the values
  await fs.writeFile(path.join(cwd, ".harness/.env"), "ROLE=coding\nPROJECT_NAME=MyProject\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(output.includes("coding"), "Output should contain the substituted ROLE value");
  assert.ok(output.includes("MyProject"), "Output should contain the substituted PROJECT_NAME value");
  assert.ok(!output.includes("{{ROLE}}"), "Output should NOT contain the raw placeholder {{ROLE}}");
  assert.ok(!output.includes("{{PROJECT_NAME}}"), "Output should NOT contain the raw placeholder {{PROJECT_NAME}}");
});

// ---------------------------------------------------------------------------
// 2. MCP config with env vars
// ---------------------------------------------------------------------------

test("env integration: MCP config placeholders are substituted", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("myserver");
  await engine.enableProvider("claude");

  // Overwrite MCP source with a placeholder in a JSON value
  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/myserver.json"),
    JSON.stringify(
      {
        servers: {
          myserver: {
            command: "node",
            args: ["server.js"],
            env: { API_KEY: "{{API_KEY}}" },
          },
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "API_KEY=sk-secret-12345\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const mcpOutput = await fs.readFile(path.join(cwd, ".mcp.json"), "utf8");
  assert.ok(mcpOutput.includes("sk-secret-12345"), "MCP output should contain the substituted API_KEY value");
  assert.ok(!mcpOutput.includes("{{API_KEY}}"), "MCP output should NOT contain the raw placeholder");
});

// ---------------------------------------------------------------------------
// 3. Subagent with env vars
// ---------------------------------------------------------------------------

test("env integration: subagent placeholders are substituted", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSubagent("team-bot");
  await engine.enableProvider("claude");

  // Overwrite the subagent source with placeholders
  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/team-bot.md"),
    "---\nname: team-bot\ndescription: Bot for {{TEAM_NAME}} team\n---\n\nYou help the {{TEAM_NAME}} team with tasks.\n",
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "TEAM_NAME=Platform\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const rendered = await fs.readFile(path.join(cwd, ".claude/agents/team-bot.md"), "utf8");
  assert.ok(rendered.includes("Platform"), "Subagent output should contain substituted TEAM_NAME");
  assert.ok(!rendered.includes("{{TEAM_NAME}}"), "Subagent output should NOT contain the raw placeholder");
});

// ---------------------------------------------------------------------------
// 4. Skill with env vars
// ---------------------------------------------------------------------------

test("env integration: skill placeholders are substituted", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSkill("linter");
  await engine.enableProvider("codex");

  // Overwrite the skill SKILL.md with a placeholder
  await fs.writeFile(
    path.join(cwd, ".harness/src/skills/linter/SKILL.md"),
    "---\nname: linter\ndescription: Lint using {{TOOL_VERSION}}\n---\n\n# Linter v{{TOOL_VERSION}}\n\nUse this skill to lint code.\n",
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "TOOL_VERSION=3.2.1\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const skillOutput = await fs.readFile(path.join(cwd, ".codex/skills/linter/SKILL.md"), "utf8");
  assert.ok(skillOutput.includes("3.2.1"), "Skill output should contain the substituted TOOL_VERSION value");
  assert.ok(!skillOutput.includes("{{TOOL_VERSION}}"), "Skill output should NOT contain the raw placeholder");
});

// ---------------------------------------------------------------------------
// 5. Hook with env vars
// ---------------------------------------------------------------------------

test("env integration: hook placeholders are substituted", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addHook("guard");
  await engine.enableProvider("claude");

  // Overwrite hook source with a placeholder in the command field
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
              command: "{{GUARD_SCRIPT}}",
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "GUARD_SCRIPT=python3 scripts/guard.py\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const hookOutput = await fs.readFile(path.join(cwd, ".claude/settings.json"), "utf8");
  assert.ok(
    hookOutput.includes("python3 scripts/guard.py"),
    "Hook output should contain the substituted GUARD_SCRIPT value",
  );
  assert.ok(!hookOutput.includes("{{GUARD_SCRIPT}}"), "Hook output should NOT contain the raw placeholder");
});

// ---------------------------------------------------------------------------
// 6. Precedence: .harness/.env wins over .env.harness
// ---------------------------------------------------------------------------

test("env integration: .harness/.env takes precedence over .env.harness", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "You work on the {{APP_ENV}} environment.\n");

  // .env.harness at project root (lower priority)
  await fs.writeFile(path.join(cwd, ".env.harness"), "APP_ENV=staging\n");

  // .harness/.env (higher priority)
  await fs.writeFile(path.join(cwd, ".harness/.env"), "APP_ENV=production\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(output.includes("production"), "Output should use .harness/.env value (production)");
  assert.ok(!output.includes("staging"), "Output should NOT use .env.harness value (staging)");
});

// ---------------------------------------------------------------------------
// 7. Unresolved placeholder generates warning
// ---------------------------------------------------------------------------

test("env integration: unresolved placeholder generates ENV_VAR_UNRESOLVED warning", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  // Ensure the env var doesn't exist in process.env either
  const originalValue = process.env.UNDEFINED_VAR;
  delete process.env.UNDEFINED_VAR;

  try {
    await fs.writeFile(
      path.join(cwd, ".harness/src/prompts/system.md"),
      "This uses {{UNDEFINED_VAR}} which is not set.\n",
    );

    // Intentionally do NOT create any .env files with UNDEFINED_VAR

    const result = await engine.apply();
    const unresolvedWarnings = result.diagnostics.filter((d) => d.code === "ENV_VAR_UNRESOLVED");
    assert.ok(unresolvedWarnings.length > 0, "Should produce ENV_VAR_UNRESOLVED diagnostic");
    assert.ok(
      unresolvedWarnings.some((d) => d.message.includes("UNDEFINED_VAR")),
      "Warning message should mention the unresolved variable name",
    );
  } finally {
    if (originalValue !== undefined) {
      process.env.UNDEFINED_VAR = originalValue;
    }
  }
});

// ---------------------------------------------------------------------------
// 8. Lock file uses raw SHA (pre-substitution)
// ---------------------------------------------------------------------------

test("env integration: lock file sourceSha256 is based on raw (pre-substitution) text", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "You are the {{ASSISTANT_TYPE}} assistant.\n");
  await fs.writeFile(path.join(cwd, ".harness/.env"), "ASSISTANT_TYPE=coding\n");

  // First apply
  const result1 = await engine.apply();
  assert.equal(
    result1.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "First apply should succeed without errors",
  );

  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const lock1 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ id: string; type: string; sourceSha256: string }>;
  };
  const promptEntity1 = lock1.entities.find((e) => e.type === "prompt");
  assert.ok(promptEntity1, "Lock should have a prompt entity");
  const sha1 = promptEntity1.sourceSha256;

  // Change only the .env value, NOT the source file
  await fs.writeFile(path.join(cwd, ".harness/.env"), "ASSISTANT_TYPE=debugging\n");

  // Second apply
  const result2 = await engine.apply();
  assert.equal(
    result2.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "Second apply should succeed without errors",
  );

  const lock2 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ id: string; type: string; sourceSha256: string }>;
  };
  const promptEntity2 = lock2.entities.find((e) => e.type === "prompt");
  assert.ok(promptEntity2, "Lock should still have a prompt entity");
  const sha2 = promptEntity2.sourceSha256;

  // The source file didn't change, so the SHA should be the same
  assert.equal(sha1, sha2, "sourceSha256 should NOT change when only .env values change");

  // But the output content should be different
  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(output.includes("debugging"), "Output should reflect the updated env var value");
});

// ---------------------------------------------------------------------------
// 9. Missing .env files don't cause errors
// ---------------------------------------------------------------------------

test("env integration: missing .env files do not cause errors", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  // Do NOT create .harness/.env or .env.harness

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "Apply should succeed without any .env files",
  );
  assert.ok(result.writtenArtifacts.length > 0, "Should still produce output artifacts");
});

// ---------------------------------------------------------------------------
// 10. Override YAML files also support env vars
// ---------------------------------------------------------------------------

test("env integration: override YAML files support env var substitution", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  // Write the prompt source
  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "You are a helpful assistant.\n");

  // Write an override YAML with a placeholder in targetPath
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.overrides.codex.yaml"),
    'version: 1\ntargetPath: "{{OUTPUT_PATH}}"\n',
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "OUTPUT_PATH=custom/AGENTS.md\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  // The override targetPath should have been substituted, placing output at custom/AGENTS.md
  const customPathExists = await fs
    .stat(path.join(cwd, "custom/AGENTS.md"))
    .then(() => true)
    .catch(() => false);
  assert.ok(customPathExists, "Output should exist at the overridden custom path (custom/AGENTS.md)");

  const defaultPathExists = await fs
    .stat(path.join(cwd, "AGENTS.md"))
    .then(() => true)
    .catch(() => false);
  assert.ok(!defaultPathExists, "Output should NOT exist at the default path when override targetPath is set");
});

// ---------------------------------------------------------------------------
// Additional integration tests
// ---------------------------------------------------------------------------

test("env integration: .env.harness at project root is loaded when .harness/.env is absent", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "Welcome to {{APP_NAME}}.\n");

  // Only create .env.harness at root, no .harness/.env
  await fs.writeFile(path.join(cwd, ".env.harness"), "APP_NAME=TestApp\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(output.includes("TestApp"), "Output should contain value from .env.harness");
});

test("env integration: multiple entity types with shared env vars", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.addSubagent("helper");
  await engine.enableProvider("claude");

  // Both entities use the same placeholder
  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "You work on {{PROJECT}}.\n");
  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/helper.md"),
    "---\nname: helper\ndescription: Helper for {{PROJECT}}\n---\n\nAssist with {{PROJECT}} tasks.\n",
  );

  await fs.writeFile(path.join(cwd, ".harness/.env"), "PROJECT=Acme\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const promptOutput = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(promptOutput.includes("Acme"), "Prompt output should contain substituted value");

  const subagentOutput = await fs.readFile(path.join(cwd, ".claude/agents/helper.md"), "utf8");
  assert.ok(subagentOutput.includes("Acme"), "Subagent output should contain substituted value");
});

test("env integration: env var value containing special characters", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  await fs.writeFile(path.join(cwd, ".harness/src/prompts/system.md"), "Connect to {{DATABASE_URL}}.\n");

  // Value with special characters (URL with query params)
  await fs.writeFile(
    path.join(cwd, ".harness/.env"),
    'DATABASE_URL="postgres://user:p@ss@localhost:5432/db?ssl=true"\n',
  );

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    `unexpected errors: ${result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`)
      .join("; ")}`,
  );

  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(
    output.includes("postgres://user:p@ss@localhost:5432/db?ssl=true"),
    "Output should contain the full URL with special characters",
  );
});

test("env integration: apply works correctly with no placeholders in source files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addPrompt();
  await engine.enableProvider("codex");

  // Source has no placeholders, but .env exists
  await fs.writeFile(
    path.join(cwd, ".harness/src/prompts/system.md"),
    "You are a helpful assistant with no placeholders.\n",
  );
  await fs.writeFile(path.join(cwd, ".harness/.env"), "UNUSED_VAR=some-value\n");

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "Apply should succeed without errors",
  );

  const output = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(output.includes("no placeholders"), "Output should contain the original text unchanged");
});

test("env integration: unresolved bare placeholders in JSON do not hard-fail apply", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("myserver");
  await engine.addHook("guard");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/myserver.json"),
    '{\n  "servers": {\n    "myserver": {\n      "command": "node",\n      "args": ["server.js"],\n      "timeoutSec": {{MISSING_TIMEOUT}}\n    }\n  }\n}\n',
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    '{\n  "mode": "strict",\n  "events": {\n    "pre_tool_use": [\n      {\n        "type": "command",\n        "command": "echo guard",\n        "timeoutSec": {{MISSING_TIMEOUT}}\n      }\n    ]\n  }\n}\n',
  );

  const result = await engine.apply();
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `unexpected errors: ${errors.map((d) => `${d.code}: ${d.message}`).join("; ")}`);

  const unresolvedWarnings = result.diagnostics.filter((d) => d.code === "ENV_VAR_UNRESOLVED");
  assert.ok(unresolvedWarnings.length >= 2, "Should emit unresolved warnings for both JSON sources");
  assert.equal(
    result.diagnostics.some((d) => d.code === "MCP_JSON_INVALID"),
    false,
    "Should not produce MCP_JSON_INVALID for unresolved bare placeholders",
  );
  assert.equal(
    result.diagnostics.some((d) => d.code === "HOOK_JSON_INVALID"),
    false,
    "Should not produce HOOK_JSON_INVALID for unresolved bare placeholders",
  );
  assert.equal(
    result.diagnostics.some((d) => d.code === "HOOK_TIMEOUT_INVALID"),
    false,
    "Should not produce HOOK_TIMEOUT_INVALID for unresolved bare placeholders",
  );

  const mcpOutput = await fs.readFile(path.join(cwd, ".mcp.json"), "utf8");
  assert.ok(
    mcpOutput.includes('"{{MISSING_TIMEOUT}}"'),
    "MCP output should preserve unresolved bare placeholders as string values",
  );
});

test("env integration: MCP and Hook lock sourceSha256 stay stable across env-only changes", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addMcp("myserver");
  await engine.addHook("guard");
  await engine.enableProvider("claude");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/myserver.json"),
    JSON.stringify(
      {
        servers: {
          myserver: {
            command: "node",
            args: ["server.js"],
            env: { API_KEY: "{{API_KEY}}" },
          },
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          pre_tool_use: [
            {
              type: "command",
              command: "{{GUARD_COMMAND}}",
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(path.join(cwd, ".harness/.env"), "API_KEY=first\nGUARD_COMMAND=echo first\n");

  const first = await engine.apply();
  assert.equal(
    first.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "First apply should succeed without errors",
  );

  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const lock1 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ id: string; type: string; sourceSha256: string }>;
  };
  const mcpSha1 = lock1.entities.find(
    (entity) => entity.type === "mcp_config" && entity.id === "myserver",
  )?.sourceSha256;
  const hookSha1 = lock1.entities.find((entity) => entity.type === "hook" && entity.id === "guard")?.sourceSha256;
  assert.ok(mcpSha1, "Lock should contain MCP source SHA");
  assert.ok(hookSha1, "Lock should contain Hook source SHA");

  await fs.writeFile(path.join(cwd, ".harness/.env"), "API_KEY=second\nGUARD_COMMAND=echo second\n");

  const second = await engine.apply();
  assert.equal(
    second.diagnostics.filter((d) => d.severity === "error").length,
    0,
    "Second apply should succeed without errors",
  );

  const lock2 = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
    entities: Array<{ id: string; type: string; sourceSha256: string }>;
  };
  const mcpSha2 = lock2.entities.find(
    (entity) => entity.type === "mcp_config" && entity.id === "myserver",
  )?.sourceSha256;
  const hookSha2 = lock2.entities.find((entity) => entity.type === "hook" && entity.id === "guard")?.sourceSha256;
  assert.ok(mcpSha2, "Lock should still contain MCP source SHA");
  assert.ok(hookSha2, "Lock should still contain Hook source SHA");
  assert.equal(mcpSha1, mcpSha2, "MCP sourceSha256 should not change when only .env values change");
  assert.equal(hookSha1, hookSha2, "Hook sourceSha256 should not change when only .env values change");
});
