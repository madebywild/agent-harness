/**
 * E2E User Journey: Third-party skill import workflow
 *
 * Covers:
 *   local catalog import (unaudited override)
 *   apply + provider projection
 *   collision handling without --replace
 *   replace flow with updated upstream content
 *   removal cleanup (source, metadata, provider outputs)
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli, runHarnessCliExpectFailure } from "../cli-helpers.ts";

interface SkillImportJsonOutput {
  ok: boolean;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  data: {
    operation: "import";
    result: {
      importedId: string;
      requestedId: string;
      replaced: boolean;
      metadataPath?: string;
      fileCount: number;
      provenance: {
        source: string;
        upstreamSkill: string;
      };
      audit: {
        audited: boolean;
        allowed: boolean;
        reason: string;
      };
    };
  };
}

interface SkillImportMetadataJson {
  id: string;
  source: string;
  upstreamSkill: string;
  files: Array<{ path: string }>;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function writeSkillVersion(
  catalogRoot: string,
  input: { skillId: string; title: string; description: string; body: string; referenceText: string },
): Promise<void> {
  const skillRoot = path.join(catalogRoot, input.skillId);
  await fs.mkdir(path.join(skillRoot, "references"), { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${input.skillId}\ndescription: ${input.description}\n---\n\n# ${input.title}\n\n${input.body}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(skillRoot, "references/checklist.md"), `${input.referenceText}\n`, "utf8");
}

describe("skills import workflow journey", { timeout: 180_000 }, () => {
  let workspace: string;
  let catalogRoot: string;
  const upstreamSkill = "web-design-guidelines";
  const localSkillId = "design-reviewer";

  test("phase 1 — init workspace, enable providers, and create local skill catalog", async () => {
    workspace = await mkTmpRepo();
    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, ["provider", "enable", "claude"]);
    await runHarnessCli(workspace, ["provider", "enable", "codex"]);
    await runHarnessCli(workspace, ["provider", "enable", "copilot"]);

    catalogRoot = path.join(workspace, "local-skill-catalog");
    await writeSkillVersion(catalogRoot, {
      skillId: upstreamSkill,
      title: "Design Reviewer v1",
      description: "Reviews web UX and accessibility decisions.",
      body: "Use semantic HTML and maintain consistent spacing rhythm.",
      referenceText: "- Verify heading hierarchy\n- Verify focus states",
    });

    assert.ok(await fileExists(path.join(catalogRoot, upstreamSkill, "SKILL.md")));
    assert.ok(await fileExists(path.join(catalogRoot, upstreamSkill, "references/checklist.md")));
  });

  test("phase 2 — import local skill with unaudited override and write provenance metadata", async () => {
    const result = await runHarnessCli(workspace, [
      "skill",
      "import",
      catalogRoot,
      "--skill",
      upstreamSkill,
      "--as",
      localSkillId,
      "--allow-unaudited",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout) as SkillImportJsonOutput;

    assert.equal(payload.ok, true);
    assert.equal(payload.data.operation, "import");
    assert.equal(payload.data.result.importedId, localSkillId);
    assert.equal(payload.data.result.requestedId, localSkillId);
    assert.equal(payload.data.result.replaced, false);
    assert.equal(payload.data.result.audit.allowed, true);
    assert.equal(payload.data.result.metadataPath, `.harness/imports/skills/${localSkillId}.json`);
    assert.ok(payload.data.result.fileCount >= 2);

    assert.ok(await fileExists(path.join(workspace, `.harness/src/skills/${localSkillId}/SKILL.md`)));
    assert.ok(await fileExists(path.join(workspace, `.harness/src/skills/${localSkillId}/references/checklist.md`)));
    assert.ok(await fileExists(path.join(workspace, `.harness/imports/skills/${localSkillId}.json`)));

    const metadata = await readWorkspaceJson<SkillImportMetadataJson>(
      workspace,
      `.harness/imports/skills/${localSkillId}.json`,
    );
    assert.equal(metadata.id, localSkillId);
    assert.equal(metadata.source, catalogRoot);
    assert.equal(metadata.upstreamSkill, upstreamSkill);
    assert.ok(metadata.files.some((file) => file.path === "SKILL.md"));
    assert.ok(metadata.files.some((file) => file.path === "references/checklist.md"));
  });

  test("phase 3 — apply renders imported skill for all enabled providers", async () => {
    const result = await runHarnessCli(workspace, ["apply", "--json"]);
    const payload = JSON.parse(result.stdout) as { ok: boolean; diagnostics?: unknown[] };
    assert.equal(payload.ok, true);

    assert.ok(await fileExists(path.join(workspace, `.claude/skills/${localSkillId}/SKILL.md`)));
    assert.ok(await fileExists(path.join(workspace, `.codex/skills/${localSkillId}/SKILL.md`)));
    assert.ok(await fileExists(path.join(workspace, `.github/skills/${localSkillId}/SKILL.md`)));
  });

  test("phase 4 — collision without --replace fails and does not claim metadata was written", async () => {
    await writeSkillVersion(catalogRoot, {
      skillId: upstreamSkill,
      title: "Design Reviewer v2",
      description: "Reviews web UX and accessibility decisions.",
      body: "Prefer high contrast and mobile-first spacing.",
      referenceText: "- Verify contrast ratio\n- Verify reduced-motion support",
    });

    const failed = await runHarnessCliExpectFailure(workspace, [
      "skill",
      "import",
      catalogRoot,
      "--skill",
      upstreamSkill,
      "--as",
      localSkillId,
      "--allow-unaudited",
      "--json",
    ]);
    const payload = JSON.parse(failed.stdout) as SkillImportJsonOutput;

    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "SKILL_IMPORT_COLLISION"));
    assert.equal(payload.data.result.metadataPath, undefined);
  });

  test("phase 5 — replace import updates workspace skill content", async () => {
    const result = await runHarnessCli(workspace, [
      "skill",
      "import",
      catalogRoot,
      "--skill",
      upstreamSkill,
      "--as",
      localSkillId,
      "--replace",
      "--allow-unaudited",
      "--json",
    ]);
    const payload = JSON.parse(result.stdout) as SkillImportJsonOutput;

    assert.equal(payload.ok, true);
    assert.equal(payload.data.result.replaced, true);
    assert.equal(payload.data.result.metadataPath, `.harness/imports/skills/${localSkillId}.json`);

    const updatedSkill = await readWorkspaceText(workspace, `.harness/src/skills/${localSkillId}/SKILL.md`);
    assert.match(updatedSkill, /Design Reviewer v2/u);
    assert.match(updatedSkill, /mobile-first spacing/u);
  });

  test("phase 6 — remove imported skill prunes metadata and provider outputs after apply", async () => {
    await runHarnessCli(workspace, ["remove", "skill", localSkillId]);
    await runHarnessCli(workspace, ["apply"]);

    assert.equal(await fileExists(path.join(workspace, `.harness/src/skills/${localSkillId}`)), false);
    assert.equal(await fileExists(path.join(workspace, `.harness/imports/skills/${localSkillId}.json`)), false);
    assert.equal(await fileExists(path.join(workspace, `.claude/skills/${localSkillId}/SKILL.md`)), false);
    assert.equal(await fileExists(path.join(workspace, `.codex/skills/${localSkillId}/SKILL.md`)), false);
    assert.equal(await fileExists(path.join(workspace, `.github/skills/${localSkillId}/SKILL.md`)), false);
  });
});
