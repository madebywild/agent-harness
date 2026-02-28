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
  const fakeGit = path.join(fakeBin, "git");
  const logFile = path.join(fakeBin, "git.log");

  await fs.writeFile(
    fakeGit,
    `#!/bin/sh
echo "$@" >> "$HARNESS_GIT_LOG"
if [ "$1" = "clone" ]; then
  checkout=""
  for arg in "$@"; do
    checkout="$arg"
  done
  mkdir -p "$checkout/skills/reviewer"
  cat > "$checkout/harness-registry.json" <<'JSON'
{"version":1,"title":"Stub Registry","description":"Stub"}
JSON
  cat > "$checkout/skills/reviewer/SKILL.md" <<'MD'
# reviewer

Remote content
MD
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ]; then
  echo "0123456789abcdef0123456789abcdef01234567"
  exit 0
fi
echo "unsupported git invocation: $@" >&2
exit 1
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
  });

  const result = await validateRegistryRepo({ repoPath: registryRepo });
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("validateRegistryRepo reports structural and metadata failures", async () => {
  const cases: Array<{
    name: string;
    files: Record<string, string>;
    expectedCode: string;
    expectedPath?: string;
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
  ];

  for (const entry of cases) {
    const repo = await mkTmpRegistry(entry.files);
    const result = await validateRegistryRepo({ repoPath: repo });
    assert.equal(result.valid, false, entry.name);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === entry.expectedCode &&
          (entry.expectedPath ? diagnostic.path === entry.expectedPath : true),
      ),
      `${entry.name}: missing expected diagnostic ${entry.expectedCode}`,
    );
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
  const validPayload = JSON.parse(validRun.stdout) as { valid: boolean; diagnostics: unknown[] };
  assert.equal(validPayload.valid, true);
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
