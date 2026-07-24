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

  const lock = await readJson<{
    entities: Array<{ id: string; type: string; registry: string }>;
  }>(cwd, ".harness/manifest.lock.json");
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
      "skills/engineering/reviewer/SKILL.md": "# reviewer\n\nRemote content\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  // Root skills live under a category folder; they are fetched by bare id (unique across categories).
  await engine.addSkill("reviewer", { registry: "corp" });

  const localSkill = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(localSkill, /Remote content/u);

  const manifest = await readJson<{
    entities: Array<{ id: string; type: string; registry: string }>;
  }>(cwd, ".harness/manifest.json");
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

test("add from git registry imports prompt-section and records provenance", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "prompt-sections/misc/house-style/SECTION.md":
        "---\nname: house-style\ndescription: House style\n---\n\nWrite terse commit messages.\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  // Prompt-sections, like skills, are categorized at the registry root and fetched by bare id.
  await engine.addPromptSection("house-style", { registry: "corp" });

  const localSection = await fs.readFile(path.join(cwd, ".harness/src/prompt-sections/house-style/SECTION.md"), "utf8");
  assert.match(localSection, /terse commit messages/u);

  const lock = await readJson<{
    entities: Array<{
      id: string;
      type: string;
      registry: string;
      importedSourceSha256?: string;
      registryRevision?: { kind: string; ref: string; commit: string };
    }>;
  }>(cwd, ".harness/manifest.lock.json");

  const lockEntity = lock.entities.find((entry) => entry.type === "prompt_section" && entry.id === "house-style");
  assert.ok(lockEntity);
  assert.equal(lockEntity?.registry, "corp");
  assert.equal(lockEntity?.registryRevision?.kind, "git");
  assert.equal(lockEntity?.registryRevision?.ref, "main");
  assert.ok(lockEntity?.registryRevision?.commit);
  assert.ok(lockEntity?.importedSourceSha256);
});

test("registry sourcing rejects non-skill / non-prompt-section entity types", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/misc/reviewer/SKILL.md": "# reviewer\n\nRemote content\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  // Only skills and prompt-sections are registry-sourceable; every other entity type is embedded in a
  // preset. Attempting to source one directly from a registry is rejected.
  await assert.rejects(
    async () => engine.addSubagent("researcher", { registry: "corp" }),
    /REGISTRY_ENTITY_UNSUPPORTED_TYPE/u,
  );
  await assert.rejects(async () => engine.addHook("guard", { registry: "corp" }), /REGISTRY_ENTITY_UNSUPPORTED_TYPE/u);
  await assert.rejects(async () => engine.addMcp("server", { registry: "corp" }), /REGISTRY_ENTITY_UNSUPPORTED_TYPE/u);
});

test("registry fetch rejects a skill id that is ambiguous across categories", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/engineering/dup/SKILL.md": "# dup\n\nEngineering copy\n",
      "skills/pm/dup/SKILL.md": "# dup\n\nPM copy\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  await assert.rejects(async () => engine.addSkill("dup", { registry: "corp" }), /ambiguous/u);
});

test("registry pull supports prompt-section entities", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "prompt-sections/misc/house-style/SECTION.md":
        "---\nname: house-style\ndescription: House style\n---\n\nVersion 1.\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addPromptSection("house-style", { registry: "corp" });

  await fs.writeFile(
    path.join(registryRepo, "prompt-sections/misc/house-style/SECTION.md"),
    "---\nname: house-style\ndescription: House style\n---\n\nVersion 2.\n",
    "utf8",
  );
  await gitCommit(registryRepo, "update section");

  const result = await engine.pullRegistry({ entityType: "prompt-section", id: "house-style" });
  assert.deepEqual(result.updatedEntities, [{ type: "prompt-section", id: "house-style" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/prompt-sections/house-style/SECTION.md"), "utf8");
  assert.match(refreshed, /Version 2/u);
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
      "skills/misc/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("reviewer", { registry: "corp" });

  await fs.writeFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "# reviewer\n\nLocal edits\n", "utf8");

  await fs.writeFile(path.join(registryRepo, "skills/misc/reviewer/SKILL.md"), "# reviewer\n\nVersion 2\n", "utf8");
  await gitCommit(registryRepo, "update skill");

  await assert.rejects(
    async () => engine.pullRegistry({ entityType: "skill", id: "reviewer" }),
    /REGISTRY_PULL_CONFLICT/u,
  );

  const forced = await engine.pullRegistry({
    entityType: "skill",
    id: "reviewer",
    force: true,
  });
  assert.deepEqual(forced.updatedEntities, [{ type: "skill", id: "reviewer" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(refreshed, /Version 2/u);
});

test("registry pull does not conflict when imported skill includes OVERRIDES sidecars", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/misc/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
      "skills/misc/reviewer/OVERRIDES.codex.yaml": "version: 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("reviewer", { registry: "corp" });

  await fs.writeFile(path.join(registryRepo, "skills/misc/reviewer/SKILL.md"), "# reviewer\n\nVersion 2\n", "utf8");
  await gitCommit(registryRepo, "update skill");

  const result = await engine.pullRegistry({
    entityType: "skill",
    id: "reviewer",
  });
  assert.deepEqual(result.updatedEntities, [{ type: "skill", id: "reviewer" }]);

  const refreshed = await fs.readFile(path.join(cwd, ".harness/src/skills/reviewer/SKILL.md"), "utf8");
  assert.match(refreshed, /Version 2/u);
});

test("registry validation accepts preset packages and registry presets can be listed and applied", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "presets/corp-starter/preset.json": JSON.stringify(
        {
          id: "corp-starter",
          name: "Corp Starter",
          description: "Enable Claude and add a corp prompt-section.",
          operations: [
            { type: "enable_provider", provider: "claude" },
            { type: "add_prompt_section", id: "system" },
          ],
        },
        null,
        2,
      ),
      "presets/corp-starter/prompt-sections/system/SECTION.md":
        "# System Prompt\n\nUse the corporate coding conventions.\n",
    },
  });

  const validation = await validateRegistryRepo({ repoPath: registryRepo });
  assert.equal(validation.valid, true);

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });

  const presets = await engine.listPresets({ registry: "corp" });
  assert.ok(presets.some((preset) => preset.id === "corp-starter" && preset.source === "registry"));

  const applied = await engine.applyPreset("corp-starter", {
    registry: "corp",
  });
  assert.equal(applied.preset.id, "corp-starter");
  assert.ok(applied.results.some((entry) => entry.target === "prompt-section:system" && entry.outcome === "applied"));

  const prompt = await fs.readFile(path.join(cwd, ".harness/src/prompt-sections/system/SECTION.md"), "utf8");
  assert.match(prompt, /corporate coding conventions/u);
});

test("registry pull preflight avoids partial updates when later entity conflicts", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
      "skills/misc/alpha/SKILL.md": "# alpha\n\nVersion 1\n",
      "skills/misc/zeta/SKILL.md": "# zeta\n\nVersion 1\n",
    },
  });

  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.addRegistry("corp", { gitUrl: registryRepo, ref: "main" });
  await engine.addSkill("alpha", { registry: "corp" });
  await engine.addSkill("zeta", { registry: "corp" });

  await fs.writeFile(path.join(cwd, ".harness/src/skills/zeta/SKILL.md"), "# zeta\n\nLocal edits\n", "utf8");

  await fs.writeFile(path.join(registryRepo, "skills/misc/alpha/SKILL.md"), "# alpha\n\nVersion 2\n", "utf8");
  await fs.writeFile(path.join(registryRepo, "skills/misc/zeta/SKILL.md"), "# zeta\n\nVersion 2\n", "utf8");
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

  await fs.mkdir(path.join(checkout, "skills", "misc", "reviewer"), { recursive: true });
  await fs.writeFile(
    path.join(checkout, "harness-registry.json"),
    '{"version":1,"title":"Stub Registry","description":"Stub"}\\n',
    "utf8",
  );
  await fs.writeFile(path.join(checkout, "skills", "misc", "reviewer", "SKILL.md"), "# reviewer\\n\\nRemote content\\n", "utf8");
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
      {
        version: 1,
        title: "Corp Registry",
        description: "Internal registry resources",
      },
      null,
      2,
    ),
    // Strict root: only skills/, prompt-sections/, and presets/ hold entities. Skills and
    // prompt-sections are organized into category folders; frontmatter tags are optional.
    "prompt-sections/misc/system/SECTION.md":
      "---\nname: system\ndescription: Base guidance\ntags: [base]\n---\n\n# System Prompt\n\nGuidance\n",
    "prompt-sections/engineering/code-conventions/SECTION.md":
      "---\nname: code-conventions\ndescription: TS conventions\n---\n\nUse type over interface.\n",
    "skills/engineering/reviewer/SKILL.md":
      "---\nname: reviewer\ndescription: Review skill\ntags: [review]\n---\n\n# reviewer\n",
    "skills/pm/grill-me/SKILL.md": "# grill-me\n\nInterview relentlessly.\n",
    "skills/design/.gitkeep": "",
    "presets/corp-starter/preset.json": JSON.stringify(
      {
        id: "corp-starter",
        name: "Corp Starter",
        description: "Enable Claude and attach a corp skill and an embedded mcp.",
        operations: [
          { type: "enable_provider", provider: "claude" },
          { type: "add_skill", id: "reviewer", source: { registry: "corp" } },
          { type: "add_mcp", id: "corp-mcp" },
        ],
      },
      null,
      2,
    ),
    "presets/corp-starter/mcp/corp-mcp.json": JSON.stringify(
      { mcpServers: { corp: { command: "corp-mcp" } } },
      null,
      2,
    ),
  });

  const result = await validateRegistryRepo({ repoPath: registryRepo });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
});

test("validateRegistryRepo reports structural and metadata failures", async () => {
  const M = JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2);
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
      files: { "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry" }, null, 2) },
      expectedCode: "REGISTRY_MANIFEST_INVALID",
      expectedPath: "harness-registry.json",
    },
    {
      name: "prompt-section missing frontmatter name/description",
      files: { "harness-registry.json": M, "prompt-sections/misc/system/SECTION.md": "# System Prompt\n\nBase\n" },
      expectedCode: "REGISTRY_PROMPT_SECTION_INVALID",
      expectedPath: "prompt-sections/misc/system/SECTION.md",
    },
    {
      name: "empty prompt-section content",
      files: { "harness-registry.json": M, "prompt-sections/misc/system/SECTION.md": "\n\n" },
      expectedCode: "REGISTRY_PROMPT_SECTION_INVALID",
      expectedPath: "prompt-sections/misc/system/SECTION.md",
    },
    {
      name: "prompt-section invalid tags",
      files: {
        "harness-registry.json": M,
        "prompt-sections/misc/system/SECTION.md": "---\nname: system\ndescription: Base\ntags: notalist\n---\n\nBody\n",
      },
      expectedCode: "REGISTRY_PROMPT_SECTION_INVALID_TAGS",
      expectedPath: "prompt-sections/misc/system/SECTION.md",
    },
    {
      name: "prompt-section duplicate id across categories",
      files: {
        "harness-registry.json": M,
        "prompt-sections/misc/dup/SECTION.md": "---\nname: dup\ndescription: A\n---\n\nA\n",
        "prompt-sections/engineering/dup/SECTION.md": "---\nname: dup\ndescription: B\n---\n\nB\n",
      },
      expectedCode: "REGISTRY_PROMPT_SECTION_DUPLICATE_ID",
    },
    {
      name: "skill without SKILL.md",
      files: { "harness-registry.json": M, "skills/engineering/reviewer/readme.md": "# reviewer\n" },
      expectedCode: "REGISTRY_SKILL_INVALID",
      expectedPath: "skills/engineering/reviewer/SKILL.md",
    },
    {
      name: "invalid skill id",
      files: { "harness-registry.json": M, "skills/engineering/bad id/SKILL.md": "# bad\n" },
      expectedCode: "REGISTRY_SKILL_INVALID",
      expectedPath: "skills/engineering/bad id",
    },
    {
      name: "skill at wrong depth (missing category)",
      files: { "harness-registry.json": M, "skills/reviewer/SKILL.md": "# reviewer\n" },
      expectedCode: "REGISTRY_SKILL_INVALID",
      expectedPath: "skills/reviewer/SKILL.md",
    },
    {
      name: "skill invalid tags",
      files: {
        "harness-registry.json": M,
        "skills/engineering/reviewer/SKILL.md": "---\nname: reviewer\ndescription: r\ntags: nope\n---\n\n# reviewer\n",
      },
      expectedCode: "REGISTRY_SKILL_INVALID_TAGS",
      expectedPath: "skills/engineering/reviewer/SKILL.md",
    },
    {
      name: "skill duplicate id across categories",
      files: {
        "harness-registry.json": M,
        "skills/engineering/dup/SKILL.md": "# dup\n",
        "skills/pm/dup/SKILL.md": "# dup\n",
      },
      expectedCode: "REGISTRY_SKILL_DUPLICATE_ID",
    },
    {
      name: "forbidden root mcp",
      files: { "harness-registry.json": M, "mcp/playwright.json": "{}\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "mcp",
    },
    {
      name: "forbidden root subagents",
      files: { "harness-registry.json": M, "subagents/researcher.md": "x\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "subagents",
    },
    {
      name: "forbidden root hooks",
      files: { "harness-registry.json": M, "hooks/guard.json": "{}\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "hooks",
    },
    {
      name: "forbidden root settings",
      files: { "harness-registry.json": M, "settings/claude.json": "{}\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "settings",
    },
    {
      name: "forbidden root commands",
      files: { "harness-registry.json": M, "commands/review.md": "---\ndescription: r\n---\n\nx\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "commands",
    },
    {
      name: "forbidden legacy root prompts",
      files: { "harness-registry.json": M, "prompts/system.md": "# System\n" },
      expectedCode: "REGISTRY_ROOT_ENTITY_FORBIDDEN",
      expectedPath: "prompts",
    },
    {
      name: "preset op declares registry source on non-skill/section entity",
      files: {
        "harness-registry.json": M,
        "presets/corp/preset.json": JSON.stringify(
          {
            id: "corp",
            name: "Corp",
            description: "Bad source usage.",
            operations: [{ type: "add_mcp", id: "server", source: { registry: "corp" } }],
          },
          null,
          2,
        ),
      },
      expectedCode: "REGISTRY_PRESET_INVALID",
      expectedPath: "presets/corp",
    },
    {
      name: "preset extends unknown parent",
      files: {
        "harness-registry.json": M,
        "presets/child/preset.json": JSON.stringify(
          {
            id: "child",
            name: "Child",
            description: "Extends a missing preset.",
            extends: "ghost",
            operations: [{ type: "enable_provider", provider: "claude" }],
          },
          null,
          2,
        ),
      },
      expectedCode: "REGISTRY_PRESET_EXTENDS_NOT_FOUND",
      expectedPath: "presets/child",
    },
    {
      name: "preset extends cycle",
      files: {
        "harness-registry.json": M,
        "presets/a/preset.json": JSON.stringify(
          {
            id: "a",
            name: "A",
            description: "A.",
            extends: "b",
            operations: [{ type: "enable_provider", provider: "claude" }],
          },
          null,
          2,
        ),
        "presets/b/preset.json": JSON.stringify(
          {
            id: "b",
            name: "B",
            description: "B.",
            extends: "a",
            operations: [{ type: "enable_provider", provider: "claude" }],
          },
          null,
          2,
        ),
      },
      expectedCode: "REGISTRY_PRESET_EXTENDS_CYCLE",
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
    "skills/engineering/reviewer/SKILL.md": "# reviewer\n\nSkill\n",
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
    data: {
      operation: string;
      result: { valid: boolean; diagnostics: unknown[] };
    };
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
  await execFileAsync("git", ["config", "user.name", "Harness Test"], {
    cwd: repo,
  });
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
