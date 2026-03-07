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
  let startupSettled = false;
  let resolveStartup: () => void = () => {};
  let rejectStartup: (error: unknown) => void = () => {};
  const startup = new Promise<void>((resolve, reject) => {
    resolveStartup = () => {
      if (startupSettled) {
        return;
      }
      startupSettled = true;
      resolve();
    };
    rejectStartup = (error: unknown) => {
      if (startupSettled) {
        return;
      }
      startupSettled = true;
      reject(error);
    };
  });

  const watchTask = engine.watch(input.debounceMs, { onReady: resolveStartup });
  watchTask.catch((error: unknown) => {
    rejectStartup(error);
  });
  await startup;

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
    runtime: {
      blockUntilExit: watchTask,
    },
  };
}
