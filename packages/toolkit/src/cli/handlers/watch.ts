import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, WatchOutput } from "../contracts.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleWatch(
  input: { debounceMs: number; json: boolean },
  context: CliResolvedContext,
): Promise<WatchOutput> {
  if (!Number.isFinite(input.debounceMs) || input.debounceMs < 0) {
    throw new Error("--debounce must be a non-negative number");
  }

  const engine = new HarnessEngine(context.cwd);

  if (input.json) {
    void engine.watch(input.debounceMs).catch((error) => {
      context.stderr(`[harness] watch failed: ${formatError(error)}`);
    });

    return {
      family: "watch",
      command: "watch",
      ok: true,
      diagnostics: [],
      exitCode: 0,
      data: {
        debounceMs: input.debounceMs,
        started: true,
      },
    };
  }

  await engine.watch(input.debounceMs);

  return {
    family: "watch",
    command: "watch",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      debounceMs: input.debounceMs,
      started: true,
    },
  };
}
