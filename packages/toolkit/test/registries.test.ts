import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { HarnessEngine } from "../src/engine.ts";
import { mkTmpRepo } from "./helpers.ts";

const execFileAsync = promisify(execFile);

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
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry" }, null, 2),
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

test("git registry with tokenEnvVar requires env var at runtime", async () => {
  const cwd = await mkTmpRepo();
  const registryRepo = await mkTmpGitRegistry({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp Registry" }, null, 2),
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

async function readJson<T>(cwd: string, relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(cwd, relativePath), "utf8");
  return JSON.parse(text) as T;
}

async function mkTmpGitRegistry(input: { files: Record<string, string> }): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-registry-test-"));
  for (const [relativePath, content] of Object.entries(input.files)) {
    const absolute = path.join(repo, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }

  await execFileAsync("git", ["init"], { cwd: repo });
  await execFileAsync("git", ["checkout", "-b", "main"], { cwd: repo }).catch(() => {
    // no-op when default branch is already main
  });
  await execFileAsync("git", ["config", "user.name", "Harness Test"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "harness-test@example.com"], { cwd: repo });
  await gitCommit(repo, "initial commit");

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
