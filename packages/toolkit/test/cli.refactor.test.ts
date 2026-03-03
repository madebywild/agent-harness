import assert from "node:assert/strict";
import { test } from "node:test";
import { runCliArgv } from "../src/cli/main.js";
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
