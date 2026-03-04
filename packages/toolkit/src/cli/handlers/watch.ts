import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, WatchOutput } from "../contracts.js";

export async function handleWatch(
  input: { debounceMs: number; json: boolean },
  context: CliResolvedContext,
): Promise<WatchOutput> {
  if (!Number.isFinite(input.debounceMs) || input.debounceMs < 0) {
    throw new Error("--debounce must be a non-negative number");
  }

  const engine = new HarnessEngine(context.cwd);
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
