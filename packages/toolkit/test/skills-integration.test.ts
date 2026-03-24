import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyAuditOutcome,
  evaluateSkillAudit,
  findSkills,
  parseSkillsFindOutput,
  parseSkillsImportReport,
  prepareSkillImport,
} from "../src/skills-integration.js";

test("parseSkillsFindOutput parses source, skill, installs, and URL", () => {
  const raw = `
vercel-labs/agent-skills@web-design-guidelines 194.7K installs
└ https://skills.sh/vercel-labs/agent-skills/web-design-guidelines

github/awesome-copilot@web-design-reviewer 8.3K installs
└ https://skills.sh/github/awesome-copilot/web-design-reviewer
`;

  const results = parseSkillsFindOutput(raw);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.source, "vercel-labs/agent-skills");
  assert.equal(results[0]?.upstreamSkill, "web-design-guidelines");
  assert.equal(results[0]?.installs, "194.7K installs");
  assert.equal(results[0]?.url, "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines");
});

test("parseSkillsImportReport extracts source and audit cells", () => {
  const raw = `
◇  Source: https://github.com/vercel-labs/agent-skills.git
◇  Security Risk Assessments ──────────────────────────────╮
│                                                          │
│                         Gen     Socket     Snyk          │
│  web-design-guidelines  Safe    0 alerts   Med Risk      │
│                                                          │
│  Details: https://skills.sh/vercel-labs/agent-skills     │
│                                                          │
├──────────────────────────────────────────────────────────╯
`;

  const report = parseSkillsImportReport(raw, "web-design-guidelines");
  assert.equal(report.resolvedSource, "https://github.com/vercel-labs/agent-skills.git");
  assert.equal(report.detailsUrl, "https://skills.sh/vercel-labs/agent-skills");
  assert.equal(report.providers.length, 3);
  assert.equal(report.providers[0]?.provider, "gen");
  assert.equal(report.providers[0]?.outcome, "pass");
  assert.equal(report.providers[2]?.provider, "snyk");
  assert.equal(report.providers[2]?.outcome, "warn");
});

test("classifyAuditOutcome handles pass, warn, and fail patterns", () => {
  assert.equal(classifyAuditOutcome("Safe"), "pass");
  assert.equal(classifyAuditOutcome("0 alerts"), "pass");
  assert.equal(classifyAuditOutcome("Low Risk"), "warn");
  assert.equal(classifyAuditOutcome("Med Risk"), "warn");
  assert.equal(classifyAuditOutcome("2 alerts"), "warn");
  assert.equal(classifyAuditOutcome("High Risk"), "fail");
});

test("evaluateSkillAudit enforces allowUnsafe and allowUnaudited overrides", () => {
  const audited = evaluateSkillAudit(
    [
      { provider: "gen", raw: "Low Risk", outcome: "warn" },
      { provider: "socket", raw: "0 alerts", outcome: "pass" },
      { provider: "snyk", raw: "Safe", outcome: "pass" },
    ],
    { allowUnsafe: false, allowUnaudited: false },
  );
  assert.equal(audited.allowed, false);
  assert.equal(audited.reason, "non_pass");

  const auditedOverride = evaluateSkillAudit(
    [
      { provider: "gen", raw: "Low Risk", outcome: "warn" },
      { provider: "socket", raw: "0 alerts", outcome: "pass" },
      { provider: "snyk", raw: "Safe", outcome: "pass" },
    ],
    { allowUnsafe: true, allowUnaudited: false },
  );
  assert.equal(auditedOverride.allowed, true);

  const unaudited = evaluateSkillAudit([], { allowUnsafe: false, allowUnaudited: false });
  assert.equal(unaudited.allowed, false);
  assert.equal(unaudited.reason, "unaudited");

  const unauditedOverride = evaluateSkillAudit([], { allowUnsafe: false, allowUnaudited: true });
  assert.equal(unauditedOverride.allowed, true);
});

test("findSkills returns parsed rows and raw fallback with mocked subprocess", async () => {
  const result = await findSkills("web design", {
    createSandbox: async () => "/tmp/unused-sandbox",
    cleanupSandbox: async () => {},
    runSkillsCliCommand: async () => ({
      stdout: `
vercel-labs/agent-skills@web-design-guidelines 194.7K installs
└ https://skills.sh/vercel-labs/agent-skills/web-design-guidelines
`,
      stderr: "",
    }),
  });

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.results.length, 1);
  assert.match(result.rawText, /web-design-guidelines/u);
});

test("prepareSkillImport validates sandbox payload and honors audit policy", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "skills-import-test-"));
  try {
    const importedRoot = path.join(sandbox, ".agents/skills/web-design-guidelines");
    await fs.mkdir(path.join(importedRoot, "references"), { recursive: true });
    await fs.writeFile(path.join(importedRoot, "SKILL.md"), "# web-design-guidelines\n", "utf8");
    await fs.writeFile(path.join(importedRoot, "references/guidelines.md"), "Use readable contrast.\n", "utf8");

    const result = await prepareSkillImport(
      {
        source: "vercel-labs/agent-skills",
        upstreamSkill: "web-design-guidelines",
        allowUnsafe: false,
        allowUnaudited: false,
      },
      {
        createSandbox: async () => sandbox,
        cleanupSandbox: async () => {},
        runSkillsCliCommand: async () => ({
          stdout: `
◇  Source: https://github.com/vercel-labs/agent-skills.git
◇  Security Risk Assessments ──────────────────────────────╮
│  web-design-guidelines  Safe    0 alerts   Safe          │
│  Details: https://skills.sh/vercel-labs/agent-skills     │
├──────────────────────────────────────────────────────────╯
`,
          stderr: "",
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.files?.length, 2);
    assert.equal(result.audit.allowed, true);
    assert.equal(result.audit.reason, "pass");
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test("prepareSkillImport blocks unaudited payload unless override is enabled", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "skills-import-unaudited-"));
  try {
    const importedRoot = path.join(sandbox, ".agents/skills/foo");
    await fs.mkdir(importedRoot, { recursive: true });
    await fs.writeFile(path.join(importedRoot, "SKILL.md"), "# foo\n", "utf8");

    const blocked = await prepareSkillImport(
      {
        source: "/tmp/local-repo",
        upstreamSkill: "foo",
        allowUnsafe: false,
        allowUnaudited: false,
      },
      {
        createSandbox: async () => sandbox,
        cleanupSandbox: async () => {},
        runSkillsCliCommand: async () => ({
          stdout: "◇ Source: /tmp/local-repo\n",
          stderr: "",
        }),
      },
    );
    assert.equal(blocked.ok, false);
    assert.ok(blocked.diagnostics.some((diagnostic) => diagnostic.code === "SKILL_IMPORT_AUDIT_UNAUDITED"));

    const allowed = await prepareSkillImport(
      {
        source: "/tmp/local-repo",
        upstreamSkill: "foo",
        allowUnsafe: false,
        allowUnaudited: true,
      },
      {
        createSandbox: async () => sandbox,
        cleanupSandbox: async () => {},
        runSkillsCliCommand: async () => ({
          stdout: "◇ Source: /tmp/local-repo\n",
          stderr: "",
        }),
      },
    );
    assert.equal(allowed.ok, true);
    assert.equal(allowed.audit.allowed, true);
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});
