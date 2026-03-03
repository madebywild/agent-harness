import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { type TestContext, after, before, test } from "node:test";
import { mkTmpRepo } from "../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "./cli-helpers.ts";
import { GiteaRegistryFixture } from "./gitea-registry-fixture.ts";

const fixture = new GiteaRegistryFixture();
let unavailableContainerRuntimeReason: string | undefined;

before(async () => {
  try {
    await fixture.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Container runtime unavailable for Testcontainers")) {
      unavailableContainerRuntimeReason = message;
      return;
    }

    throw error;
  }
});

after(async () => {
  await fixture.stop();
});

test("init seeds local registry as default and lists it", async () => {
  const workspace = await mkTmpRepo();

  await runHarnessCli(workspace, ["init"]);

  const defaultResult = await runHarnessCli(workspace, ["registry", "default", "show"]);
  assert.equal(defaultResult.stdout.trim(), "local");

  const listResult = await runHarnessCli(workspace, ["registry", "list", "--json"]);
  const payload = JSON.parse(listResult.stdout) as {
    schemaVersion: string;
    ok: boolean;
    command: string;
    data: {
      operation: string;
      registries: Array<{
        id: string;
        isDefault: boolean;
        definition: { type: string };
      }>;
    };
  };
  assert.equal(payload.schemaVersion, "1");
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "registry.list");
  assert.equal(payload.data.operation, "list");

  const listed = payload.data.registries;

  const local = listed.find((entry) => entry.id === "local");
  assert.ok(local);
  assert.equal(local?.definition.type, "local");
  assert.equal(local?.isDefault, true);
});

test("add commands without --registry use local registry", async () => {
  const workspace = await mkTmpRepo();

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["add", "prompt"]);
  await runHarnessCli(workspace, ["add", "skill", "reviewer"]);
  await runHarnessCli(workspace, ["add", "mcp", "playwright"]);

  await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/prompts/system.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/skills/reviewer/SKILL.md")));
  await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/mcp/playwright.json")));

  const manifest = await readWorkspaceJson<{
    entities: Array<{ type: string; id: string; registry: string }>;
  }>(workspace, ".harness/manifest.json");

  const promptEntity = manifest.entities.find((entity) => entity.type === "prompt" && entity.id === "system");
  const skillEntity = manifest.entities.find((entity) => entity.type === "skill" && entity.id === "reviewer");
  const mcpEntity = manifest.entities.find((entity) => entity.type === "mcp_config" && entity.id === "playwright");

  assert.equal(promptEntity?.registry, "local");
  assert.equal(skillEntity?.registry, "local");
  assert.equal(mcpEntity?.registry, "local");
});

test("registry pull is a no-op when all entities are local", async () => {
  const workspace = await mkTmpRepo();

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["add", "skill", "local-skill"]);

  const lockBefore = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
  const managedIndexBefore = await readWorkspaceText(workspace, ".harness/managed-index.json");

  const pullResult = await runHarnessCli(workspace, ["registry", "pull"]);
  assert.match(pullResult.stdout, /No imported entities matched pull criteria\./u);

  const lockAfter = await readWorkspaceText(workspace, ".harness/manifest.lock.json");
  const managedIndexAfter = await readWorkspaceText(workspace, ".harness/managed-index.json");
  assert.equal(lockAfter, lockBefore);
  assert.equal(managedIndexAfter, managedIndexBefore);
});

test("registry remove local is rejected", async () => {
  const workspace = await mkTmpRepo();

  await runHarnessCli(workspace, ["init"]);
  const failed = await runHarnessCliExpectFailure(workspace, ["registry", "remove", "local"]);

  assert.equal(failed.code, 1);
  assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_LOCAL_IMMUTABLE/u);
});

test("registry default set routes add to remote registry", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nRemote default content\n",
    },
    private: false,
    namePrefix: "default-remote",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["registry", "default", "set", "corp"]);

  const defaultResult = await runHarnessCli(workspace, ["registry", "default", "show"]);
  assert.equal(defaultResult.stdout.trim(), "corp");

  await runHarnessCli(workspace, ["add", "skill", "reviewer"]);

  const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  assert.match(skill, /Remote default content/u);

  const manifest = await readWorkspaceJson<{
    entities: Array<{ type: string; id: string; registry: string }>;
  }>(workspace, ".harness/manifest.json");
  const skillEntity = manifest.entities.find((entity) => entity.type === "skill" && entity.id === "reviewer");
  assert.equal(skillEntity?.registry, "corp");
});

test("registry pull --registry only updates targeted registry", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const corpRepo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nCorp version 1\n",
    },
    private: false,
    namePrefix: "filter-corp",
  });
  const altRepo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Alt", description: "Registry" }, null, 2),
      "skills/writer/SKILL.md": "# writer\n\nAlt version 1\n",
    },
    private: false,
    namePrefix: "filter-alt",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, [
    "registry",
    "add",
    "corp",
    "--git-url",
    corpRepo.readOnlyUrl,
    "--ref",
    corpRepo.defaultRef,
  ]);
  await runHarnessCli(workspace, [
    "registry",
    "add",
    "alt",
    "--git-url",
    altRepo.readOnlyUrl,
    "--ref",
    altRepo.defaultRef,
  ]);
  await runHarnessCli(workspace, ["add", "skill", "reviewer", "--registry", "corp"]);
  await runHarnessCli(workspace, ["add", "skill", "writer", "--registry", "alt"]);

  await corpRepo.updateFile("skills/reviewer/SKILL.md", "# reviewer\n\nCorp version 2\n", "update corp reviewer");
  await altRepo.updateFile("skills/writer/SKILL.md", "# writer\n\nAlt version 2\n", "update alt writer");

  const pullResult = await runHarnessCli(workspace, ["registry", "pull", "--registry", "corp"]);
  assert.match(pullResult.stdout, /Pulled skill 'reviewer'\./u);
  assert.doesNotMatch(pullResult.stdout, /Pulled skill 'writer'\./u);

  const corpSkill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  const altSkill = await readWorkspaceText(workspace, ".harness/src/skills/writer/SKILL.md");
  assert.match(corpSkill, /Corp version 2/u);
  assert.match(altSkill, /Alt version 1/u);
});

test("registry add + add prompt imports remote prompt and records provenance", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "prompts/system.md": "# System Prompt\n\nRemote public prompt\n",
    },
    private: false,
    namePrefix: "prompt",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["add", "prompt", "--registry", "corp"]);

  const prompt = await readWorkspaceText(workspace, ".harness/src/prompts/system.md");
  assert.match(prompt, /Remote public prompt/u);

  const manifest = await readWorkspaceJson<{
    entities: Array<{ type: string; id: string; registry: string }>;
  }>(workspace, ".harness/manifest.json");
  const promptEntity = manifest.entities.find((entity) => entity.type === "prompt" && entity.id === "system");
  assert.equal(promptEntity?.registry, "corp");

  const lock = await readWorkspaceJson<{
    entities: Array<{
      type: string;
      id: string;
      registry: string;
      importedSourceSha256?: string;
      registryRevision?: { kind: string; ref: string; commit: string };
    }>;
  }>(workspace, ".harness/manifest.lock.json");

  const lockEntity = lock.entities.find((entity) => entity.type === "prompt" && entity.id === "system");
  assert.equal(lockEntity?.registry, "corp");
  assert.equal(lockEntity?.registryRevision?.kind, "git");
  assert.equal(lockEntity?.registryRevision?.ref, repo.defaultRef);
  assert.ok(lockEntity?.registryRevision?.commit);
  assert.ok(lockEntity?.importedSourceSha256);
});

test("registry add + add skill imports remote skill", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nRemote skill content\n",
      "skills/reviewer/checklist.md": "- item\n",
    },
    private: false,
    namePrefix: "skill",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["add", "skill", "reviewer", "--registry", "corp"]);

  const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  assert.match(skill, /Remote skill content/u);

  await assert.doesNotReject(async () => fs.stat(path.join(workspace, ".harness/src/skills/reviewer/checklist.md")));
});

test("registry add + add mcp imports remote mcp config", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "mcp/playwright.json": JSON.stringify({ command: "npx", args: ["@playwright/mcp"] }, null, 2),
    },
    private: false,
    namePrefix: "mcp",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["add", "mcp", "playwright", "--registry", "corp"]);

  const mcp = await readWorkspaceJson<{ command: string; args: string[] }>(
    workspace,
    ".harness/src/mcp/playwright.json",
  );
  assert.equal(mcp.command, "npx");
  assert.deepEqual(mcp.args, ["@playwright/mcp"]);
});

test("registry pull updates imported entities after remote commit", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
    },
    private: false,
    namePrefix: "pull-update",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["add", "skill", "reviewer", "--registry", "corp"]);

  await repo.updateFile("skills/reviewer/SKILL.md", "# reviewer\n\nVersion 2\n", "update reviewer");

  await runHarnessCli(workspace, ["registry", "pull", "skill", "reviewer"]);

  const refreshed = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  assert.match(refreshed, /Version 2/u);
});

test("registry pull blocks local drift until --force", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nVersion 1\n",
    },
    private: false,
    namePrefix: "pull-conflict",
  });

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, ["registry", "add", "corp", "--git-url", repo.readOnlyUrl, "--ref", repo.defaultRef]);
  await runHarnessCli(workspace, ["add", "skill", "reviewer", "--registry", "corp"]);

  await fs.writeFile(
    path.join(workspace, ".harness/src/skills/reviewer/SKILL.md"),
    "# reviewer\n\nLocal edits\n",
    "utf8",
  );
  await repo.updateFile("skills/reviewer/SKILL.md", "# reviewer\n\nVersion 2\n", "remote update");

  const failed = await runHarnessCliExpectFailure(workspace, ["registry", "pull", "skill", "reviewer"]);
  assert.equal(failed.code, 1);
  assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_PULL_CONFLICT/u);

  await runHarnessCli(workspace, ["registry", "pull", "skill", "reviewer", "--force"]);

  const refreshed = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  assert.match(refreshed, /Version 2/u);
});

test("private registry with tokenEnvVar fails when env is missing", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nPrivate skill\n",
    },
    private: true,
    namePrefix: "private-missing",
  });

  const missingEnvVar = findMissingEnvVarName("REGISTRY_TOKEN_E2E_MISSING_");

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, [
    "registry",
    "add",
    "corp",
    "--git-url",
    repo.readOnlyUrl,
    "--ref",
    repo.defaultRef,
    "--token-env",
    missingEnvVar,
  ]);

  const failed = await runHarnessCliExpectFailure(workspace, ["add", "skill", "reviewer", "--registry", "corp"]);
  assert.equal(failed.code, 1);
  assert.match(`${failed.stdout}\n${failed.stderr}`, /REGISTRY_AUTH_MISSING/u);
});

test("private registry succeeds when tokenEnvVar is set", { concurrency: false }, async (t) => {
  if (skipIfContainerRuntimeUnavailable(t)) return;

  const workspace = await mkTmpRepo();
  const repo = await fixture.createRegistryRepo({
    files: {
      "harness-registry.json": JSON.stringify({ version: 1, title: "Corp", description: "Registry" }, null, 2),
      "skills/reviewer/SKILL.md": "# reviewer\n\nPrivate skill\n",
    },
    private: true,
    namePrefix: "private-success",
  });

  const tokenEnvVar = findMissingEnvVarName("REGISTRY_TOKEN_E2E_SET_");

  await runHarnessCli(workspace, ["init"]);
  await runHarnessCli(workspace, [
    "registry",
    "add",
    "corp",
    "--git-url",
    repo.readOnlyUrl,
    "--ref",
    repo.defaultRef,
    "--token-env",
    tokenEnvVar,
  ]);

  await runHarnessCli(workspace, ["add", "skill", "reviewer", "--registry", "corp"], {
    env: { [tokenEnvVar]: fixture.getBasicAuthHeader() },
  });

  const skill = await readWorkspaceText(workspace, ".harness/src/skills/reviewer/SKILL.md");
  assert.match(skill, /Private skill/u);
});

function skipIfContainerRuntimeUnavailable(t: TestContext): boolean {
  if (!unavailableContainerRuntimeReason) {
    return false;
  }

  t.skip(unavailableContainerRuntimeReason);
  return true;
}

function findMissingEnvVarName(prefix: string): string {
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = `${prefix}${process.pid}_${index}`;
    if (!(candidate in process.env)) {
      return candidate;
    }
  }

  throw new Error(`Could not allocate missing environment variable for prefix '${prefix}'`);
}
