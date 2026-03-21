import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { DELEGATED_INIT_PRESET_ID, launchDelegatedInit } from "../../delegated-init.js";
import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, InitOutput } from "../contracts.js";

export async function handleInit(
  input: { force: boolean; preset?: string; delegate?: string; json?: boolean },
  context: CliResolvedContext,
  dependencies?: {
    launchDelegate?: typeof launchDelegatedInit;
  },
): Promise<InitOutput> {
  const delegateProvider = input.delegate ? providerIdSchema.parse(input.delegate) : undefined;
  if (delegateProvider && input.json) {
    throw new Error("INIT_DELEGATE_JSON_UNSUPPORTED: delegated init cannot be combined with --json");
  }

  if (delegateProvider && (!context.isTty || context.isCi)) {
    throw new Error("INIT_DELEGATE_REQUIRES_TTY: delegated init requires an interactive TTY outside CI");
  }

  if (delegateProvider && input.preset && input.preset !== DELEGATED_INIT_PRESET_ID) {
    throw new Error(
      `INIT_DELEGATE_PRESET_CONFLICT: --delegate requires --preset '${DELEGATED_INIT_PRESET_ID}' or no preset`,
    );
  }

  const preset = input.preset ?? (delegateProvider ? DELEGATED_INIT_PRESET_ID : undefined);
  const engine = new HarnessEngine(context.cwd);
  await engine.init({ force: input.force });

  if (preset) {
    await engine.applyPreset(preset);
  }

  const runtime = delegateProvider
    ? {
        blockUntilExit: (dependencies?.launchDelegate ?? launchDelegatedInit)({
          cwd: context.cwd,
          env: context.env,
          provider: delegateProvider,
        }),
      }
    : undefined;

  return {
    family: "init",
    command: "init",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      force: input.force,
      preset,
      delegateProvider,
      message: delegateProvider
        ? `Initialized .harness workspace and applied preset '${preset}'. Attempting delegated prompt authoring with '${delegateProvider}'.`
        : preset
          ? `Initialized .harness workspace and applied preset '${preset}'.`
          : "Initialized .harness workspace.",
    },
    runtime,
  };
}
