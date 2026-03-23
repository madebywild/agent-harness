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
import {
  assertFrameContains,
  confirmAndWait,
  createMockApi,
  delay,
  KEYS,
  makeApplyOutput,
  makeEntityMutationOutput,
  makeInitOutput,
  makePlanOutput,
  selectCommand,
  submitAndWait,
  waitForFrame,
} from "./tui-helpers.ts";

const TEST_PRESETS = [
  { id: "starter", name: "Starter" },
  { id: "delegate", name: "Delegate" },
];

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

    // Dismiss output and verify we're back at the command selector
    await confirmAndWait(instance, (f) => f.includes("Command"));
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

    // Type skill id and submit → wait for "Registry id" prompt
    await submitAndWait(instance, "reviewer", (f) => f.includes("Registry id"));

    // Skip optional "Registry id" → wait for confirm step
    await confirmAndWait(instance, (f) => f.includes("Run 'Add skill' now?"));

    // Default is Yes, just press Enter → wait for output
    await confirmAndWait(instance, (f) => f.includes("Press Enter to continue"));

    // Verify API received correct input
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "add.skill");
    assert.equal(calls[0]?.args?.skillId, "reviewer");

    // Dismiss and return to selector
    await confirmAndWait(instance, (f) => f.includes("Command"));
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

    // Press Escape to cancel → back at command selector, no API call made
    instance.stdin.write(KEYS.ESCAPE);
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
    await confirmAndWait(instance, (f) => f.includes("preset"));

    // "Select a preset" — select "Skip preset" (first option, already focused)
    await confirmAndWait(instance, (f) => f.includes("Run 'Initialize workspace' now?"));

    // Confirm step — verify both options visible
    const confirmFrame = instance.lastFrame();
    assertFrameContains(confirmFrame, "Yes", "No");

    // Toggle to No (default is Yes, so toggle once) and submit
    instance.stdin.write(KEYS.TAB);
    await delay(50);

    // Submit "No" → back at command selector, no API call
    await confirmAndWait(instance, (f) => f.includes("Command"));
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

    // Dismiss → back at selector
    await confirmAndWait(instance, (f) => f.includes("Command"));
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

    // "Overwrite?" — press Enter (No) → wait for preset selector
    await confirmAndWait(instance, (f) => f.includes("preset"));

    // "Select a preset" — select "Delegate" → wait for provider prompt
    await submitAndWait(instance, "Delegate", (f) => f.includes("provider"));

    // Select "claude" → wait for confirm step
    await submitAndWait(instance, "claude", (f) => f.includes("Run 'Initialize workspace' now?"));

    // Confirm → wait for output
    await confirmAndWait(instance, (f) => f.includes("Press Enter to continue"));

    // Verify API received delegate option
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "init");
    assert.equal(calls[0]?.options?.delegate, "claude");

    // Dismiss
    await confirmAndWait(instance, (f) => f.includes("Command"));
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
    await confirmAndWait(instance, (f) => f.includes("Command"));

    // --- Command 2: Apply (mutating, needs confirm) ---
    // "Apply" matches both "Apply preset" and "Apply" (the apply command);
    // arrow down past "Apply preset" to reach the apply command
    instance.stdin.write("Apply");
    await delay(50);
    instance.stdin.write(KEYS.DOWN);

    // Assert the focused item is "Apply" (not "Apply preset") before submitting.
    // Match "❯ Apply" at end-of-line to avoid substring match with "❯ Apply preset".
    const applyFrame = await waitForFrame(instance, (f) => /❯ Apply$/m.test(f));
    assert.ok(/❯ Apply$/m.test(applyFrame), `Expected focused item to be "Apply", got:\n${applyFrame}`);

    instance.stdin.write(KEYS.ENTER);

    // Confirm step → submit
    await waitForFrame(instance, (f) => f.includes("now?"));
    await confirmAndWait(instance, (f) => f.includes("Press Enter to continue"));

    // Dismiss output
    await confirmAndWait(instance, (f) => f.includes("Command"));

    // --- Exit ---
    await selectCommand(instance.stdin, "Exit");

    await waitForFrame(instance, () => onExit.mock.calls.length > 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.command, "plan");
    assert.equal(calls[1]?.command, "apply");
    assert.equal(onExit.mock.calls[0]?.arguments[0], 0);
  });
});
