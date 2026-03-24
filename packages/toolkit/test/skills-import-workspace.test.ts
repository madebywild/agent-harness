import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HarnessEngine } from "../src/engine.js";
import type { PrepareSkillImportResult } from "../src/skills-integration.js";
import { mkTmpRepo } from "./helpers.ts";

function passingAudit() {
  return {
    audited: true as const,
    allowed: true,
    reason: "pass" as const,
    allowUnsafe: false,
    allowUnaudited: false,
    detailsUrl: "https://skills.sh/vercel-labs/agent-skills",
    providers: [
      { provider: "gen" as const, raw: "Safe", outcome: "pass" as const },
      { provider: "socket" as const, raw: "0 alerts", outcome: "pass" as const },
      { provider: "snyk" as const, raw: "Safe", outcome: "pass" as const },
    ],
  };
}

test("engine importSkill writes multi-file skill source, manifest registration, and provenance metadata", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();
  await engine.enableProvider("codex");

  const prepared: PrepareSkillImportResult = {
    ok: true,
    files: [
      {
        path: "SKILL.md",
        content: "# web-design-guidelines\n",
        sha256: "a",
        sizeBytes: 24,
      },
      {
        path: "references/checklist.md",
        content: "- Contrast ratio\n",
        sha256: "b",
        sizeBytes: 18,
      },
    ],
    resolvedSource: "https://github.com/vercel-labs/agent-skills.git",
    audit: passingAudit(),
    diagnostics: [],
    rawText: "",
  };

  const result = await engine.importSkill(
    {
      source: "vercel-labs/agent-skills",
      upstreamSkill: "web-design-guidelines",
    },
    {
      prepareImportImpl: async () => prepared,
    },
  );

  assert.equal(result.importedId, "web-design-guidelines");
  assert.equal(result.fileCount, 2);
  assert.equal(result.metadataPath, ".harness/imports/skills/web-design-guidelines.json");

  const manifestText = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    entities: Array<{ type: string; id: string }>;
  };
  assert.ok(
    manifest.entities.some((entity) => entity.type === "skill" && entity.id === "web-design-guidelines"),
    "imported skill entity should be registered in manifest",
  );

  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/src/skills/web-design-guidelines/SKILL.md")));
  await assert.doesNotReject(async () =>
    fs.stat(path.join(cwd, ".harness/src/skills/web-design-guidelines/references/checklist.md")),
  );
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".harness/imports/skills/web-design-guidelines.json")));

  const metadataText = await fs.readFile(path.join(cwd, ".harness/imports/skills/web-design-guidelines.json"), "utf8");
  const metadata = JSON.parse(metadataText) as {
    id: string;
    source: string;
    upstreamSkill: string;
    files: Array<{ path: string }>;
  };
  assert.equal(metadata.id, "web-design-guidelines");
  assert.equal(metadata.source, "vercel-labs/agent-skills");
  assert.equal(metadata.upstreamSkill, "web-design-guidelines");
  assert.deepEqual(metadata.files.map((file) => file.path).sort(), ["SKILL.md", "references/checklist.md"]);

  const applyResult = await engine.apply();
  assert.equal(
    applyResult.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    false,
  );
  await assert.doesNotReject(async () => fs.stat(path.join(cwd, ".codex/skills/web-design-guidelines/SKILL.md")));
  await assert.doesNotReject(async () =>
    fs.stat(path.join(cwd, ".codex/skills/web-design-guidelines/references/checklist.md")),
  );
});

test("engine importSkill leaves workspace unchanged when audit or payload validation fails", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);
  await engine.init();

  const manifestBefore = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const lockBefore = await fs.readFile(path.join(cwd, ".harness/manifest.lock.json"), "utf8");
  const indexBefore = await fs.readFile(path.join(cwd, ".harness/managed-index.json"), "utf8");

  const result = await engine.importSkill(
    {
      source: "vercel-labs/agent-skills",
      upstreamSkill: "web-design-guidelines",
    },
    {
      prepareImportImpl: async () => ({
        ok: false,
        audit: {
          audited: true,
          allowed: false,
          reason: "non_pass",
          allowUnsafe: false,
          allowUnaudited: false,
          providers: [
            { provider: "gen", raw: "Low Risk", outcome: "warn" },
            { provider: "socket", raw: "0 alerts", outcome: "pass" },
            { provider: "snyk", raw: "Med Risk", outcome: "warn" },
          ],
        },
        diagnostics: [
          {
            code: "SKILL_IMPORT_AUDIT_BLOCKED",
            severity: "error",
            message: "blocked by strict policy",
          },
        ],
        rawText: "",
      }),
    },
  );

  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "SKILL_IMPORT_AUDIT_BLOCKED"));
  assert.equal(result.fileCount, 0);

  const manifestAfter = await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8");
  const lockAfter = await fs.readFile(path.join(cwd, ".harness/manifest.lock.json"), "utf8");
  const indexAfter = await fs.readFile(path.join(cwd, ".harness/managed-index.json"), "utf8");

  assert.equal(manifestAfter, manifestBefore);
  assert.equal(lockAfter, lockBefore);
  assert.equal(indexAfter, indexBefore);

  await assert.rejects(
    async () => fs.stat(path.join(cwd, ".harness/src/skills/web-design-guidelines/SKILL.md")),
    /ENOENT/u,
  );
  await assert.rejects(
    async () => fs.stat(path.join(cwd, ".harness/imports/skills/web-design-guidelines.json")),
    /ENOENT/u,
  );
});
