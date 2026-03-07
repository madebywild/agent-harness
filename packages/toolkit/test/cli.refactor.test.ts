import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCommanderAdapter } from "../src/cli/adapters/commander.js";
import { runCliArgv, runCliCommand } from "../src/cli/main.js";
import { isNoArgShortcutEligible } from "../src/cli/utils/runtime.js";
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

test("runCliArgv no-arg non-interactive path preserves default plan behavior", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: true, isCi: false });

  const result = await runCliArgv(["--no-interactive"], capture.context);

  assert.equal(result.exitCode, 1);
  const joined = capture.stdout.join("\n");
  assert.match(joined, /WORKSPACE_NOT_INITIALIZED/u);
  assert.match(joined, /harness init/u);
  assert.equal(capture.stderr.length, 0);
});

test("runCliArgv emits versioned JSON envelope for no-arg default command", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });

  const result = await runCliArgv(["--json"], capture.context);

  assert.equal(result.exitCode, 1);
  assert.equal(capture.stdout.length, 1);
  const payload = JSON.parse(capture.stdout[0]) as {
    schemaVersion: string;
    command: string;
    ok: boolean;
    diagnostics: Array<{ code: string }>;
    meta: { cwd: string; durationMs: number };
  };

  assert.equal(payload.schemaVersion, "1");
  assert.equal(payload.command, "default.plan");
  assert.equal(payload.ok, false);
  assert.ok(payload.diagnostics.some((entry) => entry.code === "WORKSPACE_NOT_INITIALIZED"));
  assert.equal(payload.meta.cwd, cwd);
  assert.equal(typeof payload.meta.durationMs, "number");
});

test("runCliArgv applies --json envelope to explicit commands", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });

  const initResult = await runCliArgv(["init", "--json"], capture.context);
  assert.equal(initResult.exitCode, 0);

  const initPayload = JSON.parse(capture.stdout[0]) as {
    schemaVersion: string;
    command: string;
    ok: boolean;
    data: { message: string };
  };
  assert.equal(initPayload.schemaVersion, "1");
  assert.equal(initPayload.command, "init");
  assert.equal(initPayload.ok, true);
  assert.equal(initPayload.data.message, "Initialized .harness workspace.");

  capture.stdout.length = 0;

  const planResult = await runCliArgv(["plan", "--json"], capture.context);
  assert.equal(planResult.exitCode, 0);

  const planPayload = JSON.parse(capture.stdout[0]) as {
    command: string;
    ok: boolean;
    data: { result: { operations: unknown[] } };
  };
  assert.equal(planPayload.command, "plan");
  assert.equal(planPayload.ok, true);
  assert.equal(Array.isArray(planPayload.data.result.operations), true);
});

test("runCliArgv watch --json surfaces startup failures", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });

  const result = await runCliArgv(["watch", "--json"], capture.context);

  assert.equal(result.exitCode, 1);
  assert.equal(capture.stdout.length, 0);
  assert.match(capture.stderr.join("\n"), /WORKSPACE_NOT_INITIALIZED/u);
});

test("runCliCommand registry.validate defaults to context cwd when path is omitted", async () => {
  const cwd = await mkTmpRepo();
  await fs.mkdir(path.join(cwd, "skills/reviewer"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, "harness-registry.json"),
    JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(cwd, "skills/reviewer/SKILL.md"), "# reviewer\n\nSkill\n", "utf8");

  const output = await runCliCommand(
    {
      command: "registry.validate",
    },
    {
      cwd,
      env: {},
      isTty: false,
      isCi: false,
      stdout: () => {},
      stderr: () => {},
    },
  );

  assert.equal(output.family, "registry");
  assert.equal(output.command, "registry.validate");
  if (output.data.operation !== "validate") {
    assert.fail(`Expected validate operation, got '${output.data.operation}'`);
  }
  assert.equal(output.data.result.valid, true);
});

test("runCliArgv registry.validate defaults to invocation cwd when --path is omitted", async () => {
  const cwd = await mkTmpRepo();
  const capture = createCapturedContext(cwd, { isTty: false, isCi: false });
  await fs.mkdir(path.join(cwd, "skills/reviewer"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, "harness-registry.json"),
    JSON.stringify({ version: 1, title: "Corp Registry", description: "Internal" }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(cwd, "skills/reviewer/SKILL.md"), "# reviewer\n\nSkill\n", "utf8");

  const result = await runCliArgv(["registry", "validate", "--json"], capture.context);

  assert.equal(result.exitCode, 0);
  assert.equal(capture.stderr.length, 0);
  assert.equal(capture.stdout.length, 1);
  const payload = JSON.parse(capture.stdout[0]) as {
    command: string;
    ok: boolean;
    meta: { cwd: string };
    data: { result: { valid: boolean } };
  };
  assert.equal(payload.command, "registry.validate");
  assert.equal(payload.ok, true);
  assert.equal(payload.meta.cwd, cwd);
  assert.equal(payload.data.result.valid, true);
});

test("isNoArgShortcutEligible rejects commander-owned option-only invocations", () => {
  assert.equal(isNoArgShortcutEligible([]), true);
  assert.equal(isNoArgShortcutEligible(["--interactive"]), true);
  assert.equal(isNoArgShortcutEligible(["--no-interactive"]), true);
  assert.equal(isNoArgShortcutEligible(["--json"]), true);
  assert.equal(isNoArgShortcutEligible(["--cwd", "/tmp/workspace"]), true);
  assert.equal(isNoArgShortcutEligible(["--cwd=/tmp/workspace"]), true);

  assert.equal(isNoArgShortcutEligible(["--help"]), false);
  assert.equal(isNoArgShortcutEligible(["-h"]), false);
  assert.equal(isNoArgShortcutEligible(["--version"]), false);
  assert.equal(isNoArgShortcutEligible(["-V"]), false);
  assert.equal(isNoArgShortcutEligible(["--unknown"]), false);
  assert.equal(isNoArgShortcutEligible(["--cwd"]), false);
  assert.equal(isNoArgShortcutEligible(["--cwd="]), false);
});

test("runCommanderAdapter forwards resolved json mode into watch command input", async () => {
  const cwd = await mkTmpRepo();
  const calls: Array<{ json: boolean; commandJson: boolean | undefined }> = [];

  const result = await runCommanderAdapter(
    ["watch", "--json"],
    {
      cwd,
      env: {},
      stdout: () => {},
      stderr: () => {},
      now: () => 100,
      isTty: false,
      isCi: false,
    },
    {
      execute: async (input) => {
        calls.push({
          json: false,
          commandJson: typeof input.options?.json === "boolean" ? input.options.json : undefined,
        });
        return {
          family: "watch",
          command: "watch",
          ok: true,
          diagnostics: [],
          exitCode: 0,
          data: {
            debounceMs: 250,
            started: true,
          },
        };
      },
      renderOutput: (_output, _durationMs, json) => {
        const latest = calls.at(-1);
        if (latest) {
          latest.json = json;
        }
      },
      runInteractive: async () => ({ exitCode: 0 }),
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.commandJson, true);
  assert.equal(calls[0]?.json, true);
});

test("runCommanderAdapter renders watch output before awaiting long-running runtime block", async () => {
  const cwd = await mkTmpRepo();
  const calls: Array<{ rendered: boolean; json: boolean }> = [];
  let resolveBlock: (() => void) | undefined;
  const blockUntilExit = new Promise<void>((resolve) => {
    resolveBlock = resolve;
  });
  let resolveRendered: (() => void) | undefined;
  const rendered = new Promise<void>((resolve) => {
    resolveRendered = resolve;
  });

  const runPromise = runCommanderAdapter(
    ["watch", "--json"],
    {
      cwd,
      env: {},
      stdout: () => {},
      stderr: () => {},
      now: () => 100,
      isTty: false,
      isCi: false,
    },
    {
      execute: async () => ({
        family: "watch",
        command: "watch",
        ok: true,
        diagnostics: [],
        exitCode: 0,
        data: {
          debounceMs: 250,
          started: true,
        },
        runtime: {
          blockUntilExit,
        },
      }),
      renderOutput: (_output, _durationMs, json) => {
        calls.push({ rendered: true, json });
        resolveRendered?.();
      },
      runInteractive: async () => ({ exitCode: 0 }),
    },
  );

  await rendered;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.rendered, true);
  assert.equal(calls[0]?.json, true);

  let settled = false;
  void runPromise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  resolveBlock?.();
  const result = await runPromise;
  assert.equal(result.exitCode, 0);
});
