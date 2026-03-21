import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { handleInit } from "../src/cli/handlers/init.ts";
import { buildDelegatedInitTask, launchDelegatedInit } from "../src/delegated-init.ts";
import { mkTmpRepo } from "./helpers.ts";

class FakeChildProcess extends EventEmitter {
  emitExit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal);
  }

  emitError(error: Error) {
    this.emit("error", error);
  }
}

test("launchDelegatedInit uses the selected provider CLI with the shared bootstrap task", async () => {
  const calls: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
  }> = [];

  await launchDelegatedInit(
    {
      cwd: "/tmp/project",
      env: {},
      provider: "codex",
    },
    (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emitExit(0));
      return child;
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "codex");
  assert.equal(calls[0]?.cwd, "/tmp/project");
  assert.deepEqual(calls[0]?.args, ["exec", buildDelegatedInitTask()]);
});

test("handleInit auto-applies the delegate preset and launches the selected provider", async () => {
  const cwd = await mkTmpRepo();
  let launchedProvider: string | undefined;

  const output = await handleInit(
    {
      force: false,
      delegate: "claude",
      json: false,
    },
    {
      cwd,
      env: {},
      stdout: () => {},
      stderr: () => {},
      now: () => 0,
      isTty: true,
      isCi: false,
    },
    {
      launchDelegate: async ({ provider }) => {
        launchedProvider = provider;
      },
    },
  );

  assert.equal(output.data.preset, "delegate");
  assert.equal(output.data.delegateProvider, "claude");
  assert.equal(
    output.data.message,
    "Initialized .harness workspace and applied preset 'delegate'. Attempting delegated prompt authoring with 'claude'.",
  );
  assert.ok(output.runtime);
  await output.runtime?.blockUntilExit;
  assert.equal(launchedProvider, "claude");

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8")) as {
    providers: { enabled: string[] };
  };
  assert.deepEqual(manifest.providers.enabled, ["claude", "codex", "copilot"]);
});

test("handleInit rejects delegated init in json mode", async () => {
  const cwd = await mkTmpRepo();

  await assert.rejects(
    () =>
      handleInit(
        {
          force: false,
          delegate: "copilot",
          json: true,
        },
        {
          cwd,
          env: {},
          stdout: () => {},
          stderr: () => {},
          now: () => 0,
          isTty: true,
          isCi: false,
        },
      ),
    /INIT_DELEGATE_JSON_UNSUPPORTED/u,
  );
});

test("handleInit rejects delegated init without an interactive tty", async () => {
  const cwd = await mkTmpRepo();

  await assert.rejects(
    () =>
      handleInit(
        {
          force: false,
          delegate: "copilot",
          json: false,
        },
        {
          cwd,
          env: {},
          stdout: () => {},
          stderr: () => {},
          now: () => 0,
          isTty: false,
          isCi: false,
        },
      ),
    /INIT_DELEGATE_REQUIRES_TTY/u,
  );
});
