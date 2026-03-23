import assert from "node:assert/strict";
import type { render } from "ink-testing-library";
import type { InteractiveExecutionApi } from "../src/cli/adapters/interactive.js";
import type { CommandInput, CommandOutput } from "../src/cli/contracts.js";

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
  const defaultOutput: CommandOutput = {
    family: "plan",
    command: "plan",
    ok: true,
    data: { result: { operations: [], diagnostics: [] }, defaultInvocation: false },
    diagnostics: [],
    exitCode: 0,
  };

  return {
    api: {
      execute: async (input: CommandInput) => {
        calls.push(input);
        if (handler) return handler(input);
        return defaultOutput;
      },
    },
    calls,
  };
}

/** Type-to-filter in the command selector and press ENTER. */
export async function selectCommand(stdin: { write: (data: string) => void }, filterText: string): Promise<void> {
  stdin.write(filterText);
  await delay(50);
  stdin.write(KEYS.ENTER);
  await delay(50);
}
