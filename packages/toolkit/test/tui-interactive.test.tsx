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
  makeDoctorOutput,
  makeEntityMutationOutput,
  makeHealthyStatus,
  makeInitOutput,
  makeMissingStatus,
  makePlanOutput,
  makeProviderOutput,
  makeSkillsFindOutput,
  makeSkillsImportOutput,
  makeUnhealthyStatus,
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
// Journey 3b: Import third-party skill (prompts + collision policy)
// ---------------------------------------------------------------------------
describe("journey 3b — import third-party skill", { timeout: 12_000 }, () => {
  test("user searches, multi-selects, and imports multiple skills in one flow", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => {
      if (input.command === "skill.find") {
        return makeSkillsFindOutput([
          {
            source: "vercel-labs/agent-skills",
            upstreamSkill: "web-design-guidelines",
            installs: "194.7K installs",
            url: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
          },
          {
            source: "vercel-labs/agent-skills",
            upstreamSkill: "design-system-maintainer",
            installs: "88.1K installs",
            url: "https://skills.sh/vercel-labs/agent-skills/design-system-maintainer",
          },
        ]);
      }

      if (input.command === "skill.import") {
        const imported = typeof input.options?.skill === "string" ? input.options.skill : "imported-skill";
        return makeSkillsImportOutput(imported);
      }

      return makePlanOutput();
    });
    const instance = render(<App api={api} presets={TEST_PRESETS} onExit={onExit} />);

    await waitForFrame(instance, (f) => f.includes("Command"));

    await selectCommand(instance.stdin, "Search + import third-party skills");
    await waitForFrame(instance, (f) => f.includes("Search third-party skills"));
    await delay(100);

    await submitAndWait(instance, "web design", (f) => f.includes("Found 2 skill(s)"));

    // Multi-select first and second result with SPACE, then ENTER to confirm.
    instance.stdin.write(KEYS.SPACE);
    await delay(50);
    instance.stdin.write(KEYS.DOWN);
    await delay(50);
    instance.stdin.write(KEYS.SPACE);
    await delay(50);
    await waitForFrame(instance, (f) => f.includes("2 selected"));
    instance.stdin.write(KEYS.ENTER);
    await waitForFrame(instance, (f) => f.includes("Replace existing local skills"));

    // Keep defaults (No/No/No) for replace/allowUnsafe/allowUnaudited, then confirm run.
    await confirmAndWait(instance, (f) => f.includes("Allow non-pass audited skills"));
    await confirmAndWait(instance, (f) => f.includes("Allow unaudited sources"));
    await confirmAndWait(instance, (f) => f.includes("Import 2 selected skill(s) now?"));

    await confirmAndWait(instance, (f) => f.includes("Press Enter to continue"));
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.command, "skill.find");
    assert.equal(calls[0]?.args?.query, "web design");
    assert.equal(calls[1]?.command, "skill.import");
    assert.equal(calls[1]?.args?.source, "vercel-labs/agent-skills");
    assert.equal(calls[1]?.options?.skill, "web-design-guidelines");
    assert.equal(calls[1]?.options?.replace, false);
    assert.equal(calls[1]?.options?.allowUnsafe, false);
    assert.equal(calls[1]?.options?.allowUnaudited, false);
    assert.equal(calls[2]?.command, "skill.import");
    assert.equal(calls[2]?.options?.skill, "design-system-maintainer");

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

    // Give Ink one frame to apply focus movement before submitting.
    await delay(50);
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

// ---------------------------------------------------------------------------
// Journey 9: Onboarding full flow (no workspace)
// ---------------------------------------------------------------------------
describe("journey 9 — onboarding full flow", { timeout: 15_000 }, () => {
  test("missing workspace shows onboarding, guides through init + provider + prompt + apply", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => {
      if (input.command === "init") return makeInitOutput();
      if (input.command === "provider.enable") return makeProviderOutput(input.args?.provider);
      if (input.command === "add.prompt") return makeEntityMutationOutput("add.prompt", "prompt", "system");
      if (input.command === "apply") return makeApplyOutput();
      return makePlanOutput();
    });
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeMissingStatus()} onExit={onExit} />,
    );

    // Welcome screen with animated logo
    const welcomeFrame = await waitForFrame(instance, (f) => f.includes("get started"), 5000);
    assertFrameContains(welcomeFrame, "Harness");

    // Press Enter to proceed to preset selection
    await confirmAndWait(instance, (f) => f.includes("Step 1/4"));

    // Skip preset (first option, already focused)
    instance.stdin.write(KEYS.ENTER);

    // Wait for providers step (init runs automatically)
    await waitForFrame(instance, (f) => f.includes("Step 2/4"), 5000);

    // Select "claude" provider → returns to provider list with "Done" option
    await submitAndWait(instance, "claude", (f) => f.includes("Selected: claude"));

    // Select "Done" to proceed
    await submitAndWait(instance, "Done", (f) => f.includes("Step 3/4"));

    // "Add a system prompt entity?" — default Yes, press Enter
    instance.stdin.write(KEYS.ENTER);

    // Wait for completion (add-prompt + apply run automatically)
    const completeFrame = await waitForFrame(instance, (f) => f.includes("Setup complete"), 5000);
    assertFrameContains(completeFrame, "Press Enter to continue to the main menu");

    // Verify API calls: init, provider.enable, add.prompt, apply
    assert.equal(calls.length, 4);
    assert.equal(calls[0]?.command, "init");
    assert.equal(calls[1]?.command, "provider.enable");
    assert.equal(calls[1]?.args?.provider, "claude");
    assert.equal(calls[2]?.command, "add.prompt");
    assert.equal(calls[3]?.command, "apply");

    // Dismiss → main menu
    await confirmAndWait(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 10: Onboarding with preset
// ---------------------------------------------------------------------------
describe("journey 10 — onboarding with preset", { timeout: 15_000 }, () => {
  test("user selects a preset during onboarding", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => {
      if (input.command === "init") return makeInitOutput();
      if (input.command === "provider.enable") return makeProviderOutput();
      if (input.command === "apply") return makeApplyOutput();
      return makePlanOutput();
    });
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeMissingStatus()} onExit={onExit} />,
    );

    // Welcome → Enter
    await waitForFrame(instance, (f) => f.includes("get started"), 5000);
    await confirmAndWait(instance, (f) => f.includes("Step 1/4"));

    // Select "Starter" preset
    await submitAndWait(instance, "Starter", (f) => f.includes("Step 2/4"));

    // Skip providers
    instance.stdin.write(KEYS.ENTER);

    // "Add a system prompt?" — toggle to No, submit
    await waitForFrame(instance, (f) => f.includes("Step 3/4"));
    instance.stdin.write(KEYS.TAB);
    await delay(50);
    instance.stdin.write(KEYS.ENTER);

    // Wait for completion (apply runs automatically)
    await waitForFrame(instance, (f) => f.includes("Setup complete"), 5000);

    // Verify init was called with preset
    assert.equal(calls[0]?.command, "init");
    assert.equal(calls[0]?.options?.preset, "starter");
  });
});

// ---------------------------------------------------------------------------
// Journey 10b: Onboarding with multiple providers
// ---------------------------------------------------------------------------
describe("journey 10b — onboarding multi-provider", { timeout: 15_000 }, () => {
  test("user selects multiple providers during onboarding", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi((input) => {
      if (input.command === "init") return makeInitOutput();
      if (input.command === "provider.enable") return makeProviderOutput(input.args?.provider);
      if (input.command === "apply") return makeApplyOutput();
      return makePlanOutput();
    });
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeMissingStatus()} onExit={onExit} />,
    );

    // Welcome → Enter
    await waitForFrame(instance, (f) => f.includes("get started"), 5000);
    await confirmAndWait(instance, (f) => f.includes("Step 1/4"));

    // Skip preset
    instance.stdin.write(KEYS.ENTER);
    await waitForFrame(instance, (f) => f.includes("Step 2/4"), 5000);

    // Select "claude" → see it in selected list
    await submitAndWait(instance, "claude", (f) => f.includes("Selected: claude"));

    // Select "codex" → see both in selected list
    await submitAndWait(instance, "codex", (f) => f.includes("claude, codex"));

    // Select "Done" to proceed
    await submitAndWait(instance, "Done", (f) => f.includes("Step 3/4"));

    // Skip prompt → toggle to No, submit
    instance.stdin.write(KEYS.TAB);
    await delay(50);
    instance.stdin.write(KEYS.ENTER);

    // Wait for completion
    await waitForFrame(instance, (f) => f.includes("Setup complete"), 5000);

    // Verify provider.enable was called for both
    const providerCalls = calls.filter((c) => c.command === "provider.enable");
    assert.equal(providerCalls.length, 2);
    assert.equal(providerCalls[0]?.args?.provider, "claude");
    assert.equal(providerCalls[1]?.args?.provider, "codex");
  });
});

// ---------------------------------------------------------------------------
// Journey 11: Workspace warning → continue to menu
// ---------------------------------------------------------------------------
describe("journey 11 — workspace warning continue", { timeout: 10_000 }, () => {
  test("unhealthy workspace shows warning, user continues to menu", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api } = createMockApi();
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeUnhealthyStatus()} onExit={onExit} />,
    );

    // Warning banner appears with diagnostic info
    const warningFrame = await waitForFrame(instance, (f) => f.includes("Workspace issues detected"));
    assertFrameContains(warningFrame, "MANIFEST_VERSION_OUTDATED");

    // Select "Continue to menu"
    await submitAndWait(instance, "Continue", (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 12: Workspace warning → run doctor
// ---------------------------------------------------------------------------
describe("journey 12 — workspace warning run doctor", { timeout: 10_000 }, () => {
  test("unhealthy workspace shows warning, user runs doctor then continues", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api, calls } = createMockApi(() => makeDoctorOutput());
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeUnhealthyStatus()} onExit={onExit} />,
    );

    // Warning banner
    await waitForFrame(instance, (f) => f.includes("Workspace issues detected"));

    // Select "Run doctor"
    await submitAndWait(instance, "Run doctor", (f) => f.includes("Press Enter to continue"));

    // Verify doctor was called
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "doctor");

    // Dismiss → main menu
    await confirmAndWait(instance, (f) => f.includes("Command"));
  });
});

// ---------------------------------------------------------------------------
// Journey 13: Healthy workspace (unchanged behavior)
// ---------------------------------------------------------------------------
describe("journey 13 — healthy workspace unchanged", { timeout: 10_000 }, () => {
  test("healthy workspace status shows command menu directly", async () => {
    const onExit = mock.fn((_code: number) => {});
    const { api } = createMockApi();
    const instance = render(
      <App api={api} presets={TEST_PRESETS} workspaceStatus={makeHealthyStatus()} onExit={onExit} />,
    );

    // Should go straight to command menu
    await waitForFrame(instance, (f) => f.includes("Command"));

    // Exit
    await selectCommand(instance.stdin, "Exit");
    await waitForFrame(instance, () => onExit.mock.calls.length > 0);
    assert.equal(onExit.mock.calls[0]?.arguments[0], 0);
  });
});
