import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HarnessEngine } from "../src/engine.ts";
import { validateRegistryRepo } from "../src/registry-validator.ts";
import { mkTmpRepo } from "./helpers.ts";

const execFileAsync = promisify(execFile);
const toolkitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("init seeds local registry and add writes lock provenance immediately", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSkill("local-skill");

  const manifest = await readJson<{
    registries: { default: string; entries: Record<string, { type: string }> };
    entities: Array<{ id: string; type: string; registry: string }>;
  }>(cwd, ".harness/manifest.json");
  assert.equal(manifest.registries.default, "local");
  assert.deepEqual(manifest.registries.entries.local, { type: "local" });

  const skillEntity = manifest.entities.find((entity) => entity.type === "skill" && entity.id === "local-skill");
  assert.ok(skillEntity);
  assert.equal(skillEntity?.registry, "local");

  const lock = await readJson<{ entities: Array<{ id: string; type: string; registry: string }> }>(
    cwd,
    ".harness/manifest.lock.json",
  );
  const skillLock = lock.entities.find((entity) => entity.type === "skill" && entity.id === "local-skill");
  assert.ok(skillLock);
  assert.equal(skillLock?.registry, "local");
});

test("registry add/list/default/remove lifecycle", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();

  await engine.addRegistry("corp", {
    gitUrl: "https://example.com/repo.git",
    ref: "main",
  });

  const listed = await engine.listRegistries();
  assert.ok(listed.some((entry) => entry.id === "local" && entry.isDefault));
  assert.ok(listed.some((entry) => entry.id === "corp" && entry.definition.type === "git"));

  await engine.setDefaultRegistry("corp");
  assert.equal(await engine.getDefaultRegistry(), "corp");

  await assert.rejects(async () => engine.removeRegistry("corp"), /default/u);

  await engine.setDefaultRegistry("local");
  await engine.removeRegistry("corp");
  const after = await engine.listRegistries();
  assert.equal(
    after.some((entry) => entry.id === "corp"),
    false,
  );

  await assert.rejects(async () => engine.removeRegistry("local"), /REGISTRY_LOCAL_IMMUTABLE/u);
});

test("add from git registry imports sources and records registry provenance", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nRemote content\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await engine.addSkill("reviewer", { registry: "corp" });

  const localSkill = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(localSkill, /Remote content/u);

  const manifest = await readJson<{ entities: Array<{ id: string; type: string; registry: string }> }>(
    cwd,
    ".harness/manifest.json",
  );
  const entity = manifest.entities.find((entry) => entry.type === "skill" && entry.id === "reviewer");
  assert.equal(entity?.registry, "corp");

  const lock = await readJson<{
    entities: Array<{
      id: string;
      type: string;
      registry: string;
      importedSourceSha256?: string;
      registryRevision?: { kind: string; ref: string; commit: string };
    }>;
  }>(cwd, ".harness/manifest.lock.json");

  const lockEntity = lock.entities.find((entry) => entry.type === "skill" && entry.id === "reviewer");
  assert.ok(lockEntity);
  assert.equal(lockEntity?.registry, "corp");
  assert.equal(lockEntity?.registryRevision?.kind, "git");
  assert.equal(lockEntity?.registryRevision?.ref, "main");
  assert.ok(lockEntity?.registryRevision?.commit);
  assert.ok(lockEntity?.importedSourceSha256);
});

test("add from git registry imports subagent and records provenance", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "subagents/researcher.md":
        "---\nname: researcher\ndescription: Research helper\n---\n\nFocus on synthesis and citations.\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await engine.addSubagent("researcher", { registry: "corp" });

  const localSubagent = await fs.readFile(path.join(cwd, ".harness/src/subagents/researcher.md"), "utf8");
  assert.match(localSubagent, /Research helper/u);

  const lock = await readJson<{
    entities: Array<{
      id: string;
      type: string;
      registry: string;
      importedSourceSha256?: string;
      registryRevision?: { kind: string; ref: string; commit: string };
    }>;
  }>(cwd, ".harness/manifest.lock.json");

  const lockEntity = lock.entities.find((entry) => entry.type === "subagent" && entry.id === "researcher");
  assert.ok(lockEntity);
  assert.equal(lockEntity?.registry, "corp");
  assert.equal(lockEntity?.registryRevision?.kind, "git");
  assert.equal(lockEntity?.registryRevision?.ref, "main");
  assert.ok(lockEntity?.registryRevision?.commit);
  assert.ok(lockEntity?.importedSourceSha256);
});

test("add from git registry imports hook and records provenance", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "hooks/guard.json": JSON.stringify(
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
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await engine.addHook("guard", { registry: "corp" });

  const localHook = await readJson<{ mode: string; events: Record<string, unknown> }>(
    cwd,
    ".harness/src/hooks/guard.json",
  );
  assert.equal(localHook.mode, "strict");
  assert.ok(localHook.events.turn_complete);

  const lock = await readJson<{
    entities: Array<{
      id: string;
      type: string;
      registry: string;
      importedSourceSha256?: string;
      registryRevision?: { kind: string; ref: string; commit: string };
    }>;
  }>(cwd, ".harness/manifest.lock.json");

  const lockEntity = lock.entities.find((entry) => entry.type === "hook" && entry.id === "guard");
  assert.ok(lockEntity);
  assert.equal(lockEntity?.registry, "corp");
  assert.equal(lockEntity?.registryRevision?.kind, "git");
  assert.equal(lockEntity?.registryRevision?.ref, "main");
  assert.ok(lockEntity?.registryRevision?.commit);
  assert.ok(lockEntity?.importedSourceSha256);
});

test("git registry import fails when harness-registry.json is missing", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "skills/reviewer/SKILL.md": "# reviewer\n\nRemote content\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await assert.rejects(async () => engine.addSkill("reviewer", { registry: "corp" }), /REGISTRY_MANIFEST_MISSING/u);
});

test("registry pull blocks local drift unless --force", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("reviewer", { registry: "corp" });

  await fs.writeFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "# reviewer\n\nLocal edits\n", "utf8");

  await fs.writeFile(path.join(registryRepo, "skills/reviewer/SKILL.md"), "# reviewer\n\nVersion 2\n", "utf8");
  await gitCommit(registryRepo, "update skill");

  await assert.rejects(
    async () => engine.pullRegistry({ entityType: "skill", id: "reviewer" }),
    /REGISTRY_PULL_CONFLICT/u,
  );

  const forced = await engine.pullRegistry({ entityType: "skill", id: "reviewer", force: true });
  assert.deepEqual(forced.updatedEntities, [{ type: "skill", id: "reviewer" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(refreshed, /Version 2/u);
});

test("registry pull supports subagent entities", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "subagents/researcher.md":
        "---\nname: researcher\ndescription: Research helper\n---\n\nVersion 1 instructions.\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSubagent("researcher", { registry: "corp" });

  await fs.writeFile(
    path.join(cwd, ".harness/src/subagents/researcher.md"),
    "---\nname: researcher\ndescription: Research helper\n---\n\nLocal edits.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(registryRepo, "subagents/researcher.md"),
    "---\nname: researcher\ndescription: Research helper\n---\n\nVersion 2 instructions.\n",
    "utf8",
  );
  await gitCommit(registryRepo, "update subagent");

  await assert.rejects(
    async () => engine.pullRegistry({ entityType: "subagent", id: "researcher" }),
    /REGISTRY_PULL_CONFLICT/u,
  );

  const forced = await engine.pullRegistry({ entityType: "subagent", id: "researcher", force: true });
  assert.deepEqual(forced.updatedEntities, [{ type: "subagent", id: "researcher" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/subagents/researcher.md"), "utf8");
  assert.match(refreshed, /Version 2 instructions/u);
});

test("registry pull supports hook entities", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "hooks/guard.json": JSON.stringify(
        {
          mode: "strict",
          events: {
            turn_complete: [
              {
                type: "notify",
                command: ["python3", "scripts/version1.py"],
              },
            ],
          },
        },
        null,
        2,
      ),
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addHook("guard", { registry: "corp" });

  await fs.writeFile(
    path.join(cwd, ".harness/src/hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          turn_complete: [
            {
              type: "notify",
              command: ["python3", "scripts/local-edits.py"],
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
    path.join(registryRepo, "hooks/guard.json"),
    JSON.stringify(
      {
        mode: "strict",
        events: {
          turn_complete: [
            {
              type: "notify",
              command: ["python3", "scripts/version2.py"],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await gitCommit(registryRepo, "update hook");

  await assert.rejects(async () => engine.pullRegistry({ entityType: "hook", id: "guard" }), /REGISTRY_PULL_CONFLICT/u);

  const forced = await engine.pullRegistry({ entityType: "hook", id: "guard", force: true });
  assert.deepEqual(forced.updatedEntities, [{ type: "hook", id: "guard" }]);

  const refreshed = await readJson<{
    mode: string;
    events: { turn_complete: Array<{ command: string[] }> };
  }>(cwd, ".harness/src/hooks/guard.json");
  assert.deepEqual(refreshed.events.turn_complete[0]?.command, ["python3", "scripts/version2.py"]);
});

test("registry pull does not conflict when imported skill includes OVERRIDES sidecars", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
      "skills/reviewer/OVERRIDES.codex.yaml": "version: 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("reviewer", { registry: "corp" });

  await fs.writeFile(path.join(registryRepo, "skills/reviewer/SKILL.md"), "# reviewer\n\nVersion 2\n", "utf8");
  await gitCommit(registryRepo, "update skill");

  const result = await engine.pullRegistry({ entityType: "skill", id: "reviewer" });
  assert.deepEqual(result.updatedEntities, [{ type: "skill", id: "reviewer" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(refreshed, /Version 2/u);
});

test("registry pull preflight avoids partial updates when later entity conflicts", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/alpha/SKILL.md": "# alpha\n\nVersion 1\n",
      "skills/zeta/SKILL.md": "# zeta\n\nVersion 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("alpha", { registry: "corp" });
  await engine.addSkill("zeta", { registry: "corp" });

  await fs.writeFile(path.join(cwd, ".harness/src/skills/zeta/SKILL.md"), "# zeta\n\nLocal edits\n", "utf8");

  await fs.writeFile(path.join(registryRepo, "skills/alpha/SKILL.md"), "# alpha\n\nVersion 2\n", "utf8");
  await fs.writeFile(path.join(registryRepo, "skills/zeta/SKILL.md"), "# zeta\n\nVersion 2\n", "utf8");
  await gitCommit(registryRepo, "update all skills");

  await assert.rejects(async () => engine.pullRegistry(), /REGISTRY_PULL_CONFLICT/u);

  const alphaAfter = await fs.readFile(path.join(cwd, ".harness/src/skills/alpha/SKILL.md"), "utf8");
  assert.match(alphaAfter, /Version 1/u);
});

test("registry pull does not rewrite lock/index when all targets are non-git", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.addSkill("local-skill");

  const manifestPath = path.join(cwd, ".harness/manifest.json");
  const manifest = await readJson<{
    registries: {
      default: string;
      entries: Record<string, { type: "local" | "git"; url?: string; ref?: string }>;
    };
    entities: Array<{ id: string; type: string; registry: string }>;
  }>(cwd, ".harness/manifest.json");

  manifest.registries.entries.mirror = { type: "local" };
  const entity = manifest.entities.find((entry) => entry.type === "skill" && entry.id === "local-skill");
  assert.ok(entity);
  entity.registry = "mirror";
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const lockPath = path.join(cwd, ".harness/manifest.lock.json");
  const managedIndexPath = path.join(cwd, ".harness/managed-index.json");
  const lockBefore = await fs.readFile(lockPath, "utf8");
  const managedIndexBefore = await fs.readFile(managedIndexPath, "utf8");

  const result = await engine.pullRegistry();
  assert.deepEqual(result.updatedEntities, []);

  const lockAfter = await fs.readFile(lockPath, "utf8");
  const managedIndexAfter = await fs.readFile(managedIndexPath, "utf8");
  assert.equal(lockAfter, lockBefore);
  assert.equal(managedIndexAfter, managedIndexBefore);
});

test("git registry with tokenEnvVar requires env var at runtime", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nRemote content\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  const tokenEnvVar = findMissingEnvVarName("REGISTRY_TOKEN_MISSING_");
  await engine.addRegistry("corp", {
    gitUrl: registryRepo,
    ref: "main",
    tokenEnvVar,
  });

  await assert.rejects(async () => engine.addSkill("reviewer", { registry: "corp" }), /REGISTRY_AUTH_MISSING/u);
});

test("git registry fetch passes token via git clone auth header", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();

  const fakeBin = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-fake-git-bin-"));
  const fakeGitImpl = path.join(fakeBin, "fake-git.js");
  const fakeGit = path.join(fakeBin, "git");
  const fakeGitCmd = path.join(fakeBin, "git.cmd");
  const logFile = path.join(fakeBin, "git.log");

  await fs.writeFile(
    fakeGitImpl,
    `import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const logFile = process.env.HARNESS_GIT_LOG;
if (logFile) {
  await fs.appendFile(logFile, \`\${args.join(" ")}\\n\`, "utf8");
}

if (args[0] === "clone") {
  const checkout = args.at(-1);
  if (!checkout) {
    process.stderr.write("missing checkout path\\n");
    process.exit(1);
  }

  await fs.mkdir(path.join(checkout, "skills", "reviewer"), { recursive: true });
  await fs.writeFile(
    path.join(checkout, "harness-registry.json"),
    '{"version":1,"title":"Stub Registry","description":"Stub"}\\n',
    "utf8",
  );
  await fs.writeFile(path.join(checkout, "skills", "reviewer", "SKILL.md"), "# reviewer\\n\\nRemote content\\n", "utf8");
  process.exit(0);
}

if (args[0] === "-C" && args[2] === "rev-parse" && args[3] === "HEAD") {
  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");
  process.exit(0);
}

process.stderr.write(\`unsupported git invocation: \${args.join(" ")}\\n\`);
process.exit(1);
`,
    "utf8",
  );
  await fs.writeFile(
    fakeGit,
    `#!/usr/bin/env sh
node "$(dirname "$0")/fake-git.js" "$@"
`,
    "utf8",
  );
  await fs.writeFile(
    fakeGitCmd,
    `@echo off
node "%~dp0\\fake-git.js" %*
`,
    "utf8",
  );
  await fs.chmod(fakeGit, 0o755);

  const tokenEnvVar = findMissingEnvVarName("REGISTRY_TOKEN_SET_");
  const tokenValue = "test-token-123";
  const previousPath = process.env.PATH;
  const previousToken = process.env[tokenEnvVar];
  const previousLog = process.env.HARNESS_GIT_LOG;

  process.env[tokenEnvVar] = tokenValue;
  process.env.HARNESS_GIT_LOG = logFile;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;

  try {
    await engine.addRegistry("corp", {
      gitUrl: "https://example.com/private/repo.git",
      ref: "main",
      tokenEnvVar,
    });
    await engine.addSkill("reviewer", { registry: "corp" });
  } finally {
    if (previousToken === undefined) {
      delete process.env[tokenEnvVar];
    } else {
      process.env[tokenEnvVar] = previousToken;
    }
    if (previousLog === undefined) {
      delete process.env.HARNESS_GIT_LOG;
    } else {
      process.env.HARNESS_GIT_LOG = previousLog;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }

  const logText = await fs.readFile(logFile, "utf8");
  const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${tokenValue}`).toString("base64")}`;
  assert.match(logText, new RegExp(`http\\.extraHeader=${escapeRegExp(authHeader)}`, "u"));
});

test("validateRegistryRepo passes for valid registry layout and metadata", async () => {
  const registryRepo = await mkTmpRegistry({
    "harness-registry.json": JSON.stringify(
      { version: 1, title: "Corp Registry", description: "Internal registry resources" },
      null,
      2,
    ),
    "prompts/system.md": "# System Prompt\n\nGuidance\n",
    "skills/reviewer/SKILL.md": "# reviewer\n\nSkill\n",
    "mcp/playwright.json": JSON.stringify({ command: "npx", args: ["@playwright/mcp"] }, null, 2),
    "subagents/researcher.md": "---\nname: researcher\ndescription: Research helper\n---\n\nResearch instructions.\n",
    "hooks/guard.json": JSON.stringify(
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
    "commands/review.md":
      "---\ndescription: Review staged changes\nargument-hint: [path]\n---\n\nReview the diff and summarize findings.\n",
  });

  const result = await validateRegistryRepo({ repoPath: registryRepo });
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("validateRegistryRepo reports structural and metadata failures", async () => {
  const cases: Array<{
    name: string;
    files: Record<string, string>;
    expectedCode?: string;
    expectedPath?: string;
    expectValid?: boolean;
    setup?: (repo: string) => Promise<void>;
  }> = [
    {
      name: "missing manifest",
      files: {},
      expectedCode: "REGISTRY_MANIFEST_MISSING",
      expectedPath: "harness-registry.json",
    },
    {
      name: "manifest missing description",
      files: {
        "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry" }, null, 2),
      },
      expectedCode: "REGISTRY_MANIFEST_INVALID",
      expectedPath: "harness-registry.json",
    },
    {
      name: "prompts contains extra file",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "prompts/system.md": "# System Prompt\n\nBase\n",
        "prompts/extra.md": "# Extra\n",
      },
      expectedCode: "REGISTRY_PROMPT_INVALID",
      expectedPath: "prompts/extra.md",
    },
    {
      name: "empty prompt content",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "prompts/system.md": "\n\n",
      },
      expectedCode: "REGISTRY_PROMPT_INVALID",
      expectedPath: "prompts/system.md",
    },
    {
      name: "skill without SKILL.md",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "skills/reviewer/readme.md": "# reviewer\n",
      },
      expectedCode: "REGISTRY_SKILL_INVALID",
      expectedPath: "skills/reviewer/SKILL.md",
    },
    {
      name: "invalid skill id",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "skills/bad id/SKILL.md": "# bad\n",
      },
      expectedCode: "REGISTRY_SKILL_INVALID",
      expectedPath: "skills/bad id",
    },
    {
      name: "invalid mcp json",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "mcp/playwright.json": "{invalid",
      },
      expectedCode: "REGISTRY_MCP_INVALID",
      expectedPath: "mcp/playwright.json",
    },
    {
      name: "mcp json must be object",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "mcp/playwright.json": "[]",
      },
      expectedCode: "REGISTRY_MCP_INVALID",
      expectedPath: "mcp/playwright.json",
    },
    {
      name: "mcp rejects non-json files",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "mcp/readme.md": "# docs\n",
      },
      expectedCode: "REGISTRY_MCP_INVALID",
      expectedPath: "mcp/readme.md",
    },
    {
      name: "subagent missing frontmatter block",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "subagents/researcher.md": "Instructions without frontmatter.\n",
      },
      expectedCode: "REGISTRY_SUBAGENT_INVALID",
      expectedPath: "subagents/researcher.md",
    },
    {
      name: "subagent missing required description",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "subagents/researcher.md": "---\nname: researcher\n---\n\nInstructions\n",
      },
      expectedCode: "REGISTRY_SUBAGENT_INVALID",
      expectedPath: "subagents/researcher.md",
    },
    {
      name: "subagent rejects non-markdown files",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "subagents/researcher.json": "{}\n",
      },
      expectedCode: "REGISTRY_SUBAGENT_INVALID",
      expectedPath: "subagents/researcher.json",
    },
    {
      name: "hook json must be object",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "hooks/guard.json": "[]",
      },
      expectedCode: "REGISTRY_HOOK_INVALID",
      expectedPath: "hooks/guard.json",
    },
    {
      name: "hook rejects non-json files",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "hooks/guard.md": "# guard\n",
      },
      expectedCode: "REGISTRY_HOOK_INVALID",
      expectedPath: "hooks/guard.md",
    },
    {
      name: "command missing required description",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "---\nargument-hint: '[path]'\n---\n\nReview changes.\n",
      },
      expectedCode: "REGISTRY_COMMAND_MISSING_DESCRIPTION",
      expectedPath: "commands/review.md",
    },
    {
      name: "command rejects non-markdown files",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.json": "{}\n",
      },
      expectedCode: "REGISTRY_COMMAND_INVALID_FILE_TYPE",
      expectedPath: "commands/review.json",
    },
    {
      name: "command invalid id",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/bad id.md": "---\ndescription: Review changes\n---\n\nReview changes.\n",
      },
      expectedCode: "REGISTRY_COMMAND_INVALID_ID",
      expectedPath: "commands/bad id.md",
    },
    {
      name: "command empty file",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "\n\n",
      },
      expectedCode: "REGISTRY_COMMAND_EMPTY",
      expectedPath: "commands/review.md",
    },
    {
      name: "command missing frontmatter block",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "Review changes.\n",
      },
      expectedCode: "REGISTRY_COMMAND_INVALID_FRONTMATTER",
      expectedPath: "commands/review.md",
    },
    {
      name: "command empty frontmatter block",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "---\n---\n\nReview changes.\n",
      },
      expectedCode: "REGISTRY_COMMAND_MISSING_DESCRIPTION",
      expectedPath: "commands/review.md",
    },
    {
      name: "command empty body",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "---\ndescription: Review changes\n---\n\n   \n",
      },
      expectedCode: "REGISTRY_COMMAND_EMPTY",
      expectedPath: "commands/review.md",
    },
    {
      name: "command malformed frontmatter",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
        "commands/review.md": "---\ndescription: [unterminated\n---\n\nReview changes.\n",
      },
      expectedCode: "REGISTRY_COMMAND_INVALID_FRONTMATTER",
      expectedPath: "commands/review.md",
    },
    {
      name: "empty commands directory is acceptable",
      files: {
        "harness-registry.json": JSON.stringify(
          { version: 1, title: "Corp Registry", description: "Internal" },
          null,
          2,
        ),
      },
      expectValid: true,
      setup: async (repo: string) => {
        await fs.mkdir(path.join(repo, "commands"), { recursive: true });
      },
    },
  ];

  for (const entry of cases) {
    const repo = await mkTmpRegistry(entry.files);
    await entry.setup?.(repo);
    const result = await validateRegistryRepo({ repoPath: repo });
    if (entry.expectValid) {
      assert.equal(result.valid, true, entry.name);
      assert.deepEqual(result.diagnostics, [], `${entry.name}: expected no diagnostics`);
      continue;
    }
    assert.equal(result.valid, false, entry.name);
    assert.ok(entry.expectedCode, `${entry.name}: expectedCode is required for invalid cases`);
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === entry.expectedCode),
      `${entry.name}: missing expected diagnostic code ${entry.expectedCode}`,
    );
    if (entry.expectedPath) {
      assert.ok(
        result.diagnostics.some(
          (diagnostic) => diagnostic.code === entry.expectedCode && diagnostic.path === entry.expectedPath,
        ),
        `${entry.name}: missing expected diagnostic path ${entry.expectedPath} for ${entry.expectedCode}`,
      );
    }
  }
});

test("registry validate CLI emits json and failure exit code", async () => {
  const validRepo = await mkTmpRegistry({
    "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
    "skills/reviewer/SKILL.md": "# reviewer\n\nSkill\n",
  });

  const validRun = await execFileAsync(
    "pnpm",
    ["exec", "tsx", "src/cli.ts", "registry", "validate", "--json", "--path", validRepo],
    {
      cwd: toolkitDir,
    },
  );
  const validPayload = JSON.parse(validRun.stdout) as {
    schemaVersion: string;
    ok: boolean;
    command: string;
    data: { operation: string; result: { valid: boolean; diagnostics: unknown[] } };
    diagnostics: unknown[];
  };
  assert.equal(validPayload.schemaVersion, "1");
  assert.equal(validPayload.command, "registry.validate");
  assert.equal(validPayload.ok, true);
  assert.equal(validPayload.data.operation, "validate");
  assert.equal(validPayload.data.result.valid, true);
  assert.deepEqual(validPayload.data.result.diagnostics, []);
  assert.deepEqual(validPayload.diagnostics, []);

  const invalidRepo = await mkTmpRegistry({
    "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry" }, null, 2),
  });

  await assert.rejects(
    async () =>
      execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", "registry", "validate", "--path", invalidRepo], {
        cwd: toolkitDir,
      }),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 1,
  );
});

async function readJson<T>(cwd: string, relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(cwd, relativePath), "utf8");
  return JSON.parse(text) as T;
}

async function mkTmpGitRegistry(input: { files: Record<string, string> }): Promise<string> {
  const repo = await mkTmpRegistry(input.files, "agent-harness-registry-test-");
  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: repo }).catch(() => {
    // no-op when default branch is already main
  });
  await execFileAsync("git", ["config", "user.name", "Harness Test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "harness-test@example.com"], { cwd: repo });
  await gitCommit(repo, "initial commit");

  return repo;
}

async function mkTmpRegistry(
  files: Record<string, string>,
  prefix = "agent-harness-registry-validate-test-",
): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(repo, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }
  return repo;
}

async function gitCommit(repo: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "."], { cwd: repo });
  await execFileAsync("git", ["commit", "-m", message], { cwd: repo });
}

function findMissingEnvVarName(prefix: string): string {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = `${prefix}${process.pid}_${index}`;
    if (!(candidate in process.env)) {
      return candidate;
    }
  }

  throw new Error(`Could not find an unused environment variable name for prefix '${prefix}'`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
