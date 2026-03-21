import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as TOML from "@iarna/toml";
import { HarnessEngine } from "../src/engine.ts";
import { validateRegistryRepo } from "../src/registry-validator.ts";
import { mkTmpRepo } from "./helpers.ts";

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

test("add settings scaffolds provider-specific sources and enforces one entity per provider", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();

  await engine.addSettings("codex");
  await engine.addSettings("claude");
  await engine.addSettings("copilot");

  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".harness/src/settings/codex.toml")));
  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".harness/src/settings/claude.json")));
  await assert.doesNotReject(() => fs.stat(path.join(cwd, ".harness/src/settings/copilot.json")));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    entities: Array<{ type: string; id: string; sourcePath: string }>;
  };
  const settingsEntities = manifest.entities.filter((entity) => entity.type === "settings");
  assert.deepEqual(settingsEntities.map((entity) => `${entity.id}:${entity.sourcePath}`).sort(), [
    "claude:.harness/src/settings/claude.json",
    "codex:.harness/src/settings/codex.toml",
    "copilot:.harness/src/settings/copilot.json",
  ]);

  await assert.rejects(() => engine.addSettings("codex"), /already exists/u);
});

test("validate enforces settings provider ids and provider-specific source paths", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();

  const manifestPath = path.join(cwd, ".harness/manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    entities: Array<Record<string, unknown>>;
  };
  manifest.entities.push(
    {
      id: "invalid-provider",
      type: "settings",
      registry: "local",
      sourcePath: ".harness/src/settings/invalid-provider.json",
      enabled: true,
    },
    {
      id: "codex",
      type: "settings",
      registry: "local",
      sourcePath: ".harness/src/settings/codex.json",
      enabled: true,
    },
  );
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.mkdir(path.join(cwd, ".harness/src/settings"), { recursive: true });
  await fs.writeFile(path.join(cwd, ".harness/src/settings/invalid-provider.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(cwd, ".harness/src/settings/codex.json"), "{}\n", "utf8");

  const validation = await engine.validate();
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SETTINGS_ID_INVALID"));
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "SETTINGS_SOURCE_INVALID"));
});

test("codex merges legacy state and settings with settings precedence", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addMcp("playwright");
  await engine.addSettings("codex");
  await engine.enableProvider("codex");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/playwright.json"),
    JSON.stringify(
      {
        servers: {
          playwright: {
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
    path.join(cwd, ".harness/src/settings/codex.toml"),
    '[mcp_servers.playwright]\ncommand = "npx"\nargs = ["custom.js"]\n\n[features]\napproval_policy = "on-request"\n',
    "utf8",
  );

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(result.diagnostics),
  );

  const parsed = TOML.parse(await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8")) as {
    mcp_servers?: Record<string, { command?: string; args?: string[] }>;
    features?: { approval_policy?: string };
  };
  assert.equal(parsed.mcp_servers?.playwright?.command, "npx");
  assert.deepEqual(parsed.mcp_servers?.playwright?.args, ["custom.js"]);
  assert.equal(parsed.features?.approval_policy, "on-request");

  const lock = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.lock.json"), "utf8")) as {
    outputs: Array<{ path: string; ownerEntityIds: string[] }>;
  };
  const codexConfig = lock.outputs.find((entry) => entry.path === ".codex/config.toml");
  assert.ok(codexConfig);
  assert.deepEqual(codexConfig?.ownerEntityIds, ["codex", "playwright"]);
});

test("claude merges hook projection and settings with settings precedence", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addHook("guard");
  await engine.addSettings("claude");
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
              command: "echo from-hook",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/claude.json"),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo from-settings",
                },
              ],
            },
          ],
        },
        theme: "team-dark",
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(result.diagnostics),
  );

  const rendered = JSON.parse(await fs.readFile(path.join(cwd, ".claude/settings.json"), "utf8")) as {
    hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    theme?: string;
  };
  assert.equal(rendered.theme, "team-dark");
  assert.equal(rendered.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command, "echo from-settings");
});

test("copilot renders settings without changing mcp or hook outputs", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addMcp("playwright");
  await engine.addHook("guard");
  await engine.addSettings("copilot");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/mcp/playwright.json"),
    JSON.stringify(
      {
        servers: {
          playwright: {
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
  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/copilot.json"),
    JSON.stringify(
      {
        "editor.formatOnSave": true,
      },
      null,
      2,
    ),
    "utf8",
  );

  const result = await engine.apply();
  assert.equal(
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(result.diagnostics),
  );

  const settings = JSON.parse(await fs.readFile(path.join(cwd, ".vscode/settings.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const mcp = JSON.parse(await fs.readFile(path.join(cwd, ".vscode/mcp.json"), "utf8")) as {
    servers?: Record<string, unknown>;
  };
  const hooks = JSON.parse(await fs.readFile(path.join(cwd, ".github/hooks/harness.generated.json"), "utf8")) as {
    hooks?: Record<string, unknown[]>;
  };

  assert.equal(settings["editor.formatOnSave"], true);
  assert.ok(mcp.servers?.playwright);
  assert.ok(hooks.hooks?.preToolUse);
});

test("settings loader supports env substitution and structural validation", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addSettings("codex");
  await engine.addSettings("copilot");
  await engine.enableProvider("codex");
  await engine.enableProvider("copilot");

  await fs.writeFile(path.join(cwd, ".harness/.env"), "MODEL=gpt-5\nFONT=14\n", "utf8");
  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/codex.toml"),
    'model = "{{MODEL}}"\n[ui]\nfont = "{{FONT}}"\n',
    "utf8",
  );
  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/copilot.json"),
    JSON.stringify(
      {
        "editor.fontSize": "{{FONT}}",
      },
      null,
      2,
    ),
    "utf8",
  );

  const applyOk = await engine.apply();
  assert.equal(
    applyOk.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(applyOk.diagnostics),
  );

  const codex = TOML.parse(await fs.readFile(path.join(cwd, ".codex/config.toml"), "utf8")) as {
    model?: string;
    ui?: { font?: string };
  };
  const copilot = JSON.parse(await fs.readFile(path.join(cwd, ".vscode/settings.json"), "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(codex.model, "gpt-5");
  assert.equal(codex.ui?.font, "14");
  assert.equal(copilot["editor.fontSize"], "14");

  await engine.addSettings("claude");
  await engine.enableProvider("claude");
  await fs.writeFile(path.join(cwd, ".harness/src/settings/claude.json"), '["bad"]\n', "utf8");

  const applyBad = await engine.apply();
  assert.ok(applyBad.diagnostics.some((diagnostic) => diagnostic.code === "SETTINGS_STRUCTURE_INVALID"));

  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/claude.json"),
    JSON.stringify(
      {
        "experimental.someUnknownKey": true,
      },
      null,
      2,
    ),
    "utf8",
  );
  const applyUnknown = await engine.apply();
  assert.equal(
    applyUnknown.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(applyUnknown.diagnostics),
  );
});

test("settings lifecycle supports remove and apply idempotency", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addSettings("copilot");
  await engine.enableProvider("copilot");

  await fs.writeFile(
    path.join(cwd, ".harness/src/settings/copilot.json"),
    JSON.stringify(
      {
        "files.trimTrailingWhitespace": true,
      },
      null,
      2,
    ),
    "utf8",
  );

  const first = await engine.apply();
  assert.equal(
    first.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(first.diagnostics),
  );
  const lockBefore = await fs.readFile(path.join(cwd, ".harness/manifest.lock.json"), "utf8");

  const second = await engine.apply();
  assert.equal(
    second.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
    JSON.stringify(second.diagnostics),
  );
  const lockAfter = await fs.readFile(path.join(cwd, ".harness/manifest.lock.json"), "utf8");
  assert.equal(lockAfter, lockBefore);

  const removed = await engine.remove("settings", "copilot", true);
  assert.deepEqual(removed, { entityType: "settings", id: "copilot" });
  await engine.apply();

  assert.equal(await fileExists(path.join(cwd, ".harness/src/settings/copilot.json")), false);
  assert.equal(await fileExists(path.join(cwd, ".vscode/settings.json")), false);
});

test("settings keeps unmanaged-output and cross-provider collision protections", async () => {
  const unmanagedCwd = await mkTmpRepo();
  const unmanagedEngine = new HarnessEngine(unmanagedCwd);
  await unmanagedEngine.init();
  await unmanagedEngine.addSettings("copilot");
  await unmanagedEngine.enableProvider("copilot");
  await fs.mkdir(path.join(unmanagedCwd, ".vscode"), { recursive: true });
  await fs.writeFile(path.join(unmanagedCwd, ".vscode/settings.json"), "{}\n", "utf8");

  const unmanagedApply = await unmanagedEngine.apply();
  assert.ok(unmanagedApply.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_COLLISION_UNMANAGED"));

  const collisionCwd = await mkTmpRepo();
  const collisionEngine = new HarnessEngine(collisionCwd);
  await collisionEngine.init();
  await collisionEngine.addPrompt();
  await collisionEngine.addSettings("copilot");
  await collisionEngine.enableProvider("codex");
  await collisionEngine.enableProvider("copilot");
  await fs.writeFile(
    path.join(collisionCwd, ".harness/src/prompts/system.overrides.codex.yaml"),
    "version: 1\ntargetPath: .vscode/settings.json\n",
    "utf8",
  );

  const collisionApply = await collisionEngine.apply();
  assert.ok(collisionApply.diagnostics.some((diagnostic) => diagnostic.code === "OUTPUT_PATH_COLLISION"));
});

test("registry import/pull and validation support settings entities", async () => {
  const registry = await fs.mkdtemp(path.join(os.tmpdir(), "settings-registry-"));
  await fs.mkdir(path.join(registry, "settings"), { recursive: true });
  await fs.writeFile(
    path.join(registry, "harness-registry.json"),
    JSON.stringify({ version: 1, title: "Registry", description: "Settings registry" }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(registry, "settings/codex.toml"), 'model = "gpt-5"\n', "utf8");

  await fs.writeFile(path.join(registry, ".gitignore"), "", "utf8");
  await fs.writeFile(path.join(registry, ".gitattributes"), "", "utf8");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync("git", ["init"], { cwd: registry });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: registry }).catch(() => {});
  await execFileAsync("git", ["config", "user.name", "Harness Test"], { cwd: registry });
  await execFileAsync("git", ["config", "user.email", "harness-test@example.com"], { cwd: registry });
  await execFileAsync("git", ["add", "."], { cwd: registry });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: registry });

  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registry, ref: "main" });
  await engine.addSettings("codex", { registry: "corp" });

  const imported = await fs.readFile(path.join(cwd, ".harness/src/settings/codex.toml"), "utf8");
  assert.match(imported, /gpt-5/u);

  await fs.writeFile(path.join(cwd, ".harness/src/settings/codex.toml"), 'model = "local"\n', "utf8");
  await fs.writeFile(path.join(registry, "settings/codex.toml"), 'model = "gpt-5.4"\n', "utf8");
  await execFileAsync("git", ["add", "."], { cwd: registry });
  await execFileAsync("git", ["commit", "-m", "update settings"], { cwd: registry });

  await assert.rejects(() => engine.pullRegistry({ entityType: "settings", id: "codex" }), /REGISTRY_PULL_CONFLICT/u);
  const pulled = await engine.pullRegistry({ entityType: "settings", id: "codex", force: true });
  assert.deepEqual(pulled.updatedEntities, [{ type: "settings", id: "codex" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/settings/codex.toml"), "utf8");
  assert.match(refreshed, /gpt-5\.4/u);

  const validRegistry = await validateRegistryRepo({ repoPath: registry });
  assert.equal(validRegistry.valid, true);

  await fs.writeFile(path.join(registry, "settings/invalid.json"), "{}\n", "utf8");
  const invalidRegistry = await validateRegistryRepo({ repoPath: registry });
  assert.equal(invalidRegistry.valid, false);
  assert.ok(invalidRegistry.diagnostics.some((diagnostic) => diagnostic.code === "REGISTRY_SETTINGS_INVALID"));
});
