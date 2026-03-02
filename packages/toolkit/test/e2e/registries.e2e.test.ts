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
