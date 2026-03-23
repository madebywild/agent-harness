import assert from "node:assert/strict";
import type { render } from "ink-testing-library";
import type { InteractiveExecutionApi, WorkspaceStatus } from "../src/cli/adapters/interactive.js";
import type { CommandInput, CommandOutput, EntityMutationOutput, ProviderOutput } from "../src/cli/contracts.js";
import type { CliEntityType, ProviderId } from "../src/types.js";

export const KEYS = {
  ENTER: "\r",
  ESCAPE: "\x1B",
  UP: "\x1B[A",
  DOWN: "\x1B[B",
  LEFT: "\x1B[D",
  RIGHT: "\x1B[C",
  BACKSPACE: "\x7F",
  TAB: "\t",
} as const;

export function delay(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until a rendered frame satisfies `predicate`.
 * ink-testing-library exposes no frame-change event, so polling is the only option.
 */
export async function waitForFrame(
  instance: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = instance.lastFrame();
    if (frame && predicate(frame)) return frame;
    await delay(20);
  }
  throw new Error(`Frame condition not met within ${timeoutMs}ms. Last frame:\n${instance.lastFrame()}`);
}

export function assertFrameContains(frame: string | undefined, ...texts: string[]): void {
  assert.ok(frame, "Expected a rendered frame but got undefined");
  for (const text of texts) {
    assert.ok(frame.includes(text), `Frame should contain "${text}" but got:\n${frame}`);
  }
}

export interface MockApi {
  api: InteractiveExecutionApi;
  calls: CommandInput[];
}

export function createMockApi(handler?: (input: CommandInput) => CommandOutput | Promise<CommandOutput>): MockApi {
  const calls: CommandInput[] = [];
  return {
    api: {
      execute: async (input: CommandInput) => {
        calls.push(input);
        if (handler) return handler(input);
        return makePlanOutput();
      },
    },
    calls,
  };
}

// ---------------------------------------------------------------------------
// Output factories
// ---------------------------------------------------------------------------

export function makePlanOutput(ok = true): CommandOutput {
  return {
    family: "plan",
    command: "plan",
    ok,
    data: {
      result: { operations: [], diagnostics: [] },
      defaultInvocation: false,
    },
    diagnostics: [],
    exitCode: ok ? 0 : 1,
  };
}

export function makeApplyOutput(ok = true): CommandOutput {
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

export function makeEntityMutationOutput(
  command: CommandInput["command"],
  entityType: CliEntityType,
  id: string,
): CommandOutput {
  const output: EntityMutationOutput = {
    family: "entity-mutation",
    command,
    ok: true,
    data: {
      operation: "add",
      entityType,
      id,
      message: `Added ${entityType} '${id}'.`,
    },
    diagnostics: [],
    exitCode: 0,
  };
  return output;
}

export function makeInitOutput(): CommandOutput {
  return {
    family: "init",
    command: "init",
    ok: true,
    data: { force: false, message: "Initialized .harness workspace." },
    diagnostics: [],
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

type Stdin = { write: (data: string) => void };
type Instance = ReturnType<typeof render>;

/** Type-to-filter in the command selector and press ENTER. */
export async function selectCommand(stdin: Stdin, filterText: string): Promise<void> {
  stdin.write(filterText);
  await delay(50);
  stdin.write(KEYS.ENTER);
  await delay(50);
}

/** Write text + ENTER, then wait for the next frame matching `predicate`. */
export async function submitAndWait(
  instance: Instance,
  text: string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  instance.stdin.write(text);
  await delay(50);
  instance.stdin.write(KEYS.ENTER);
  return waitForFrame(instance, predicate);
}

/** Press ENTER and wait for the next frame matching `predicate`. */
export async function confirmAndWait(instance: Instance, predicate: (frame: string) => boolean): Promise<string> {
  await delay(50);
  instance.stdin.write(KEYS.ENTER);
  return waitForFrame(instance, predicate);
}

// ---------------------------------------------------------------------------
// Workspace status factories
// ---------------------------------------------------------------------------

export function makeHealthyStatus(): WorkspaceStatus {
  return { state: "healthy" };
}

export function makeMissingStatus(): WorkspaceStatus {
  return { state: "missing" };
}

export function makeUnhealthyStatus(
  diagnostics = [
    {
      code: "MANIFEST_VERSION_OUTDATED",
      severity: "error" as const,
      message: "Detected version 0; latest is 1",
    },
  ],
): WorkspaceStatus {
  return { state: "unhealthy", diagnostics };
}

// ---------------------------------------------------------------------------
// Additional output factories
// ---------------------------------------------------------------------------

export function makeProviderOutput(provider: ProviderId = "claude"): CommandOutput {
  const output: ProviderOutput = {
    family: "provider",
    command: "provider.enable",
    ok: true,
    data: {
      action: "enable",
      provider,
      message: `Provider '${provider}' enabled.`,
    },
    diagnostics: [],
    exitCode: 0,
  };
  return output;
}

export function makeDoctorOutput(ok = true): CommandOutput {
  return {
    family: "doctor",
    command: "doctor",
    ok,
    data: {
      result: {
        healthy: ok,
        migrationNeeded: !ok,
        migrationPossible: true,
        files: [],
        diagnostics: ok ? [] : [{ code: "TEST", severity: "error", message: "Test issue" }],
      },
    },
    diagnostics: [],
    exitCode: ok ? 0 : 1,
  };
}
