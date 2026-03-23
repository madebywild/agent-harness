/**
 * E2E User Journeys: TUI Interactive Mode
 *
 * Simulates real user behavior through the Ink-based interactive wizard.
 * Each journey renders the App component with a mocked InteractiveExecutionApi,
 * sends keystrokes via stdin, and asserts on visible TUI output.
 */

import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
// biome-ignore lint/correctness/noUnusedImports: tsx test runner doesn't use tsconfig jsx transform — React must be in scope
import React from "react";
import { App } from "../src/cli/adapters/interactive.js";
import type { CommandInput, CommandOutput } from "../src/cli/contracts.js";
import { assertFrameContains, createMockApi, delay, KEYS, selectCommand, waitForFrame } from "./tui-helpers.ts";

const TEST_PRESETS = [
  { id: "starter", name: "Starter" },
  { id: "delegate", name: "Delegate" },
];

function makePlanOutput(ok = true): CommandOutput {
  return {
    family: "plan",
    command: "plan",
    ok,
    data: { result: { operations: [], diagnostics: [] }, defaultInvocation: false },
    diagnostics: [],
    exitCode: ok ? 0 : 1,
  };
}

function makeApplyOutput(ok = true): CommandOutput {
  return {
    family: "apply",
    command: "apply",
    ok,
    data: {
      result: {
        operations: [],
        diagnostics: [],
        writtenArtifacts: [],
        prunedArtifacts: [],
      },
    },
    diagnostics: [],
    exitCode: ok ? 0 : 1,
  };
}

function makeEntityMutationOutput(command: CommandInput["command"], entityType: string, id: string): CommandOutput {
  return {
    family: "entity-mutation",
    command,
    ok: true,
    data: {
      operation: "add",
      entityType: entityType as "skill",
      id,
      message: `Added ${entityType} '${id}'.`,
    },
    diagnostics: [],
    exitCode: 0,
  };
}

function makeInitOutput(): CommandOutput {
  return {
    family: "init",
    command: "init",
    ok: true,
    data: { force: false, message: "Initialized .harness workspace." },
    diagnostics: [],
    exitCode: 0,
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Journey 1: Exit immediately
// ---------------------------------------------------------------------------
describe("journey 1 — exit immediately", { timeout: 10_000 }, () => {
  test("user opens interactive mode and exits right away", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api } = createMockApi();
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));
    await selectCommand(instance.stdin, "Exit");

    await waitForFrame(instance, () => onExit.mock.calls.length > 0);
    assert.equal(onExit.mock.calls[0]?.arguments[0], 0);
  });
});

// ---------------------------------------------------------------------------
// Journey 2: Run a read-only command (plan)
// ---------------------------------------------------------------------------
describe("journey 2 — run read-only command", { timeout: 10_000 }, () => {
  test("user selects plan, sees output, returns to selector", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi(() => makePlanOutput());
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Plan" — no prompts, not mutating, goes straight to running
    await selectCommand(instance.stdin, "Plan");

    // Wait for output step (shows success marker)
    const outputFrame = await waitForFrame(instance, (f) => f.includes("Plan"));
    assertFrameContains(outputFrame, "Press Enter to continue");

    // Verify API was called with correct command
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "plan");

    // Dismiss output
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Verify we're back at the command selector
    await waitForFrame(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 3: Add a skill entity (prompts + confirm)
// ---------------------------------------------------------------------------
describe("journey 3 — add skill with prompts", { timeout: 10_000 }, () => {
  test("user adds a skill, fills prompts, confirms, sees output", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => makeEntityMutationOutput(input.command, "skill", "reviewer"));
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Add skill"
    await selectCommand(instance.stdin, "Add skill");

    // Verify "Skill id" prompt appears
    await waitForFrame(instance, (f) => f.includes("Skill id"));

    // Type skill id and submit
    instance.stdin.write("reviewer");
    await delay(50);
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Optional "Registry id" prompt — just press Enter to skip
    await waitForFrame(instance, (f) => f.includes("Registry id"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Confirm step — "Run 'Add skill' now?"
    await waitForFrame(instance, (f) => f.includes("Run 'Add skill' now?"));
    // Default is Yes, just press Enter
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Wait for output
    await waitForFrame(instance, (f) => f.includes("Press Enter to continue"));

    // Verify API received correct input
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "add.skill");
    assert.equal(calls[0]?.args?.skillId, "reviewer");

    // Dismiss and return to selector
    instance.stdin.write(KEYS.ENTER);
    await waitForFrame(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 4: Cancel mid-prompt
// ---------------------------------------------------------------------------
describe("journey 4 — cancel mid-prompt", { timeout: 10_000 }, () => {
  test("user starts add skill, escapes back to command selector", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi();
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Add skill"
    await selectCommand(instance.stdin, "Add skill");
    await waitForFrame(instance, (f) => f.includes("Skill id"));

    // Press Escape to cancel
    instance.stdin.write(KEYS.ESCAPE);
    await delay(50);

    // Verify back at command selector, no API call made
    await waitForFrame(instance, (f) => f.includes("Command"));
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Journey 5: Decline confirmation
// ---------------------------------------------------------------------------
describe("journey 5 — decline confirmation", { timeout: 10_000 }, () => {
  test("user fills init prompts but declines to run", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi();
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Initialize workspace"
    await selectCommand(instance.stdin, "Initialize");
    await waitForFrame(instance, (f) => f.includes("Overwrite"));

    // "Overwrite existing .harness workspace?" — default No, just press Enter
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // "Select a preset" — select "Skip preset" (first option, already focused)
    await waitForFrame(instance, (f) => f.includes("preset"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Confirm step — "Run 'Initialize workspace' now?"
    const confirmFrame = await waitForFrame(instance, (f) => f.includes("Run 'Initialize workspace' now?"));
    assertFrameContains(confirmFrame, "Yes", "No");

    // Toggle to No (default is Yes, so toggle once) and submit
    instance.stdin.write(KEYS.TAB);
    await delay(50);
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Back at command selector, no API call
    await waitForFrame(instance, (f) => f.includes("Command"));
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Journey 6: Command execution failure
// ---------------------------------------------------------------------------
describe("journey 6 — command failure", { timeout: 10_000 }, () => {
  test("user runs plan that fails, sees error output", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api } = createMockApi(() => {
      throw new Error("Workspace not initialized");
    });
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Plan"
    await selectCommand(instance.stdin, "Plan");

    // Wait for error output
    const errorFrame = await waitForFrame(instance, (f) => f.includes("Error"));
    assertFrameContains(errorFrame, "Workspace not initialized");
    assertFrameContains(errorFrame, "Press Enter to continue");

    // Dismiss
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Back at selector
    await waitForFrame(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 7: Init with delegate preset (dynamic prompt injection)
// ---------------------------------------------------------------------------
describe("journey 7 — delegate preset dynamic prompt", { timeout: 10_000 }, () => {
  test("selecting delegate preset injects provider selection prompt", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi(() => makeInitOutput());
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    // Select "Initialize workspace"
    await selectCommand(instance.stdin, "Initialize");
    await waitForFrame(instance, (f) => f.includes("Overwrite"));

    // "Overwrite?" — press Enter (No)
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // "Select a preset" — select "Delegate"
    await waitForFrame(instance, (f) => f.includes("preset"));
    instance.stdin.write("Delegate");
    await delay(50);
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Dynamic prompt: "Select the provider CLI to delegate prompt authoring to"
    await waitForFrame(instance, (f) => f.includes("provider"));

    // Select "claude" (first option)
    instance.stdin.write("claude");
    await delay(50);
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Confirm step
    await waitForFrame(instance, (f) => f.includes("Run 'Initialize workspace' now?"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Wait for output
    await waitForFrame(instance, (f) => f.includes("Press Enter to continue"));

    // Verify API received delegate option
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "init");
    assert.equal(calls[0]?.options?.delegate, "claude");

    // Dismiss
    instance.stdin.write(KEYS.ENTER);
    await waitForFrame(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 8: Multi-command session
// ---------------------------------------------------------------------------
describe("journey 8 — multi-command session", { timeout: 15_000 }, () => {
  test("user runs plan, then apply, then exits", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => {
      if (input.command === "plan") return makePlanOutput();
      if (input.command === "apply") return makeApplyOutput();
      return makePlanOutput();
    });
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    // --- Command 1: Plan ---
    await waitForFrame(instance, (f) => f.includes("Command"));
    await selectCommand(instance.stdin, "Plan");
    await waitForFrame(instance, (f) => f.includes("Press Enter to continue"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // --- Command 2: Apply (mutating, needs confirm) ---
    await waitForFrame(instance, (f) => f.includes("Command"));
    // "Apply" matches both "Apply preset" and "Apply planned operations…";
    // arrow down past "Apply preset" to reach the apply command, then submit
    instance.stdin.write("Apply");
    await delay(50);
    instance.stdin.write(KEYS.DOWN);
    await delay(50);
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // Confirm step
    await waitForFrame(instance, (f) => f.includes("now?"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    await waitForFrame(instance, (f) => f.includes("Press Enter to continue"));
    instance.stdin.write(KEYS.ENTER);
    await delay(50);

    // --- Exit ---
    await waitForFrame(instance, (f) => f.includes("Command"));
    await selectCommand(instance.stdin, "Exit");

    await waitForFrame(instance, () => onExit.mock.calls.length > 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.command, "plan");
    assert.equal(calls[1]?.command, "apply");
    assert.equal(onExit.mock.calls[0]?.arguments[0], 0);
  });
});
