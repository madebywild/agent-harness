import { runCommanderAdapter } from "./adapters/commander.js";
import { runInteractiveAdapter } from "./adapters/interactive.js";
import { dispatch } from "./command-registry.js";
import type { CliExecutionContext, CliResolvedContext, CommandInput, CommandOutput } from "./contracts.js";
import { renderJsonOutput } from "./renderers/json.js";
import { renderTextOutput } from "./renderers/text.js";
import {
  detectPrimaryCommand,
  ensureInteractiveFeasible,
  parseGlobalCwd,
  parseGlobalJsonFlag,
  parseRuntimeFlags,
  resolveCliContext,
  resolveNoArgMode,
} from "./utils/runtime.js";

function renderOutput(
  output: CommandOutput,
  input: {
    durationMs: number;
    json: boolean;
    context: CliResolvedContext;
  },
): void {
  if (input.json) {
    input.context.stdout(renderJsonOutput(output, { cwd: input.context.cwd, durationMs: input.durationMs }));
    return;
  }

  renderTextOutput(output, input.context.stdout);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCliCommand(input: CommandInput, context?: CliExecutionContext): Promise<CommandOutput> {
  const resolvedContext = resolveCliContext(context);
  return dispatch(input.command, input, resolvedContext);
}

export async function runCliArgv(
  argv: readonly string[],
  context?: CliExecutionContext,
): Promise<{ exitCode: number }> {
  const baseContext = resolveCliContext(context);

  try {
    const runtimeFlags = parseRuntimeFlags(argv);
    if (runtimeFlags.forceInteractive && runtimeFlags.forceNonInteractive) {
      throw new Error("Cannot combine --interactive and --no-interactive");
    }

    const hasJsonFlag = parseGlobalJsonFlag(argv);
    const primaryCommand = detectPrimaryCommand(argv);

    if (primaryCommand === null && !runtimeFlags.forceNonInteractive) {
      const mode =
        hasJsonFlag && !runtimeFlags.forceInteractive
          ? "command"
          : resolveNoArgMode({
              argv,
              env: baseContext.env,
              isTty: baseContext.isTty,
              isCi: baseContext.isCi,
            });

      if (mode === "interactive") {
        ensureInteractiveFeasible({ isTty: baseContext.isTty, isCi: baseContext.isCi });
        const cwd = parseGlobalCwd(argv, baseContext.cwd);
        const interactiveContext: CliResolvedContext = {
          ...baseContext,
          cwd,
        };

        const result = await runInteractiveAdapter(interactiveContext, {
          execute: (input) => runCliCommand(input, interactiveContext),
          renderOutput: (output, durationMs, json) => {
            renderOutput(output, {
              context: interactiveContext,
              durationMs,
              json,
            });
          },
        });

        return {
          exitCode: result.exitCode,
        };
      }
    }

    const commandResult = await runCommanderAdapter(argv, baseContext, {
      execute: (input, commandContext) => runCliCommand(input, commandContext),
      renderOutput: (output, durationMs, json, renderContext) => {
        renderOutput(output, {
          durationMs,
          json,
          context: renderContext,
        });
      },
      runInteractive: async (interactiveContext) =>
        runInteractiveAdapter(interactiveContext, {
          execute: (input) => runCliCommand(input, interactiveContext),
          renderOutput: (output, durationMs, json) => {
            renderOutput(output, {
              durationMs,
              json,
              context: interactiveContext,
            });
          },
        }),
    });

    return commandResult;
  } catch (error) {
    baseContext.stderr(`Error: ${toErrorMessage(error)}`);
    return {
      exitCode: 1,
    };
  }
}
