import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { runCliArgv, runCliCommand } from "../src/cli/main.js";
import { HarnessEngine } from "../src/engine.js";
import { mkTmpRepo } from "./helpers.ts";

function createCapturedContext(cwd: string, options?: { isTty?: boolean; isCi?: boolean }) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    context: {
      cwd,
      isTty: options?.isTty,
      isCi: options?.isCi,
      env: {},
      stdout: (line: string) => {
        stdout.push(line);
      },
      stderr: (line: string) => {
        stderr.push(line);
      },
    },
    stdout,
    stderr,
  };
}

test("runCliCommand skill.import requires --skill option", async () => {
  const cwd = await mkTmpRepo();

  await assert.rejects(
    () =>
      runCliCommand(
        {
          command: "skill.import",
          args: { source: "vercel-labs/agent-skills" },
        },
        {
          cwd,
          env: {},
          isTty: false,
          isCi: false,
          stdout: () => {},
          stderr: () => {},
        },
      ),
    /Missing required option: skill/u,
  );
});

test("runCliArgv skill find emits json envelope with parsed results and raw fallback", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });
  mock.method(HarnessEngine.prototype, "findSkills", async (query: string) => ({
    query,
    results: [
      {
        source: "vercel-labs/agent-skills",
        upstreamSkill: "web-design-guidelines",
        installs: "194.7K installs",
        url: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
        rawLine: "vercel-labs/agent-skills@web-design-guidelines 194.7K installs",
      },
    ],
    rawText: "vercel-labs/agent-skills@web-design-guidelines 194.7K installs",
    diagnostics: [],
  }));

  try {
    const result = await runCliArgv(["skill", "find", "web", "design", "--json"], capture.context);
    assert.equal(result.exitCode, 0);
    assert.equal(capture.stdout.length, 1);
    const payload = JSON.parse(capture.stdout[0]) as {
      command: string;
      ok: boolean;
      data: {
        operation: string;
        query: string;
        results: Array<{ source: string; upstreamSkill: string }>;
        rawText: string;
      };
    };
    assert.equal(payload.command, "skill.find");
    assert.equal(payload.ok, true);
    assert.equal(payload.data.operation, "find");
    assert.equal(payload.data.query, "web design");
    assert.equal(payload.data.results[0]?.source, "vercel-labs/agent-skills");
    assert.match(payload.data.rawText, /web-design-guidelines/u);
  } finally {
    mock.restoreAll();
  }
});

test("runCliArgv skill import emits json envelope with provenance and audit decision", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });
  mock.method(HarnessEngine.prototype, "importSkill", async () => ({
    importedId: "web-design-guidelines",
    requestedId: "web-design-guidelines",
    replaced: false,
    provenance: {
      source: "vercel-labs/agent-skills",
      resolvedSource: "https://github.com/vercel-labs/agent-skills.git",
      upstreamSkill: "web-design-guidelines",
      skillsCliVersion: "1.4.6",
    },
    metadataPath: ".harness/imports/skills/web-design-guidelines.json",
    fileCount: 2,
    audit: {
      audited: true,
      allowed: true,
      reason: "pass",
      allowUnsafe: false,
      allowUnaudited: false,
      detailsUrl: "https://skills.sh/vercel-labs/agent-skills",
      providers: [
        { provider: "gen", raw: "Safe", outcome: "pass" },
        { provider: "socket", raw: "0 alerts", outcome: "pass" },
        { provider: "snyk", raw: "Safe", outcome: "pass" },
      ],
    },
    diagnostics: [],
  }));

  try {
    const result = await runCliArgv(
      ["skill", "import", "vercel-labs/agent-skills", "--skill", "web-design-guidelines", "--json"],
      capture.context,
    );
    assert.equal(result.exitCode, 0);
    assert.equal(capture.stdout.length, 1);
    const payload = JSON.parse(capture.stdout[0]) as {
      command: string;
      ok: boolean;
      data: {
        operation: string;
        result: {
          importedId: string;
          metadataPath: string;
          fileCount: number;
          audit: { allowed: boolean; reason: string };
        };
      };
    };
    assert.equal(payload.command, "skill.import");
    assert.equal(payload.ok, true);
    assert.equal(payload.data.operation, "import");
    assert.equal(payload.data.result.importedId, "web-design-guidelines");
    assert.equal(payload.data.result.metadataPath, ".harness/imports/skills/web-design-guidelines.json");
    assert.equal(payload.data.result.fileCount, 2);
    assert.equal(payload.data.result.audit.allowed, true);
    assert.equal(payload.data.result.audit.reason, "pass");
  } finally {
    mock.restoreAll();
  }
});

test("runCliArgv skill import requires --replace when target skill already exists", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });

  const initResult = await runCliArgv(["init"], capture.context);
  assert.equal(initResult.exitCode, 0);

  const addResult = await runCliArgv(["add", "skill", "web-design-guidelines"], capture.context);
  assert.equal(addResult.exitCode, 0);

  capture.stdout.length = 0;
  capture.stderr.length = 0;

  const importResult = await runCliArgv(
    ["skill", "import", "vercel-labs/agent-skills", "--skill", "web-design-guidelines", "--json"],
    capture.context,
  );
  assert.equal(importResult.exitCode, 1);
  assert.equal(capture.stdout.length, 1);
  const payload = JSON.parse(capture.stdout[0]) as {
    command: string;
    ok: boolean;
    diagnostics: Array<{ code: string }>;
    data: { operation: string; result: { metadataPath?: string } };
  };
  assert.equal(payload.command, "skill.import");
  assert.equal(payload.ok, false);
  assert.equal(payload.data.operation, "import");
  assert.equal(payload.data.result.metadataPath, undefined);
  assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "SKILL_IMPORT_COLLISION"));
});
