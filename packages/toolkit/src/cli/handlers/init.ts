import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { DELEGATED_INIT_PRESET_ID, launchDelegatedInit } from "../../delegated-init.js";
import { HarnessEngine } from "../../engine.js";
import { parseUHaulPrecedencePrimary, runUHaulInitFlow } from "../../u-haul.js";
import type { CliResolvedContext, InitOutput } from "../contracts.js";

export async function handleInit(
  input: {
    force: boolean;
    preset?: string;
    delegate?: string;
    json?: boolean;
    uHaul?: boolean;
    uHaulPrecedence?: string;
  },
  context: CliResolvedContext,
  dependencies?: {
    launchDelegate?: typeof launchDelegatedInit;
    runUHaul?: typeof runUHaulInitFlow;
  },
): Promise<InitOutput> {
  if (input.uHaulPrecedence && !input.uHaul) {
    throw new Error("INIT_U_HAUL_PRECEDENCE_REQUIRES_U_HAUL: --u-haul-precedence requires --u-haul");
  }

  if (input.uHaul && input.preset) {
    throw new Error("INIT_U_HAUL_PRESET_CONFLICT: --u-haul cannot be combined with --preset");
  }

  if (input.uHaul && input.delegate) {
    throw new Error("INIT_U_HAUL_DELEGATE_CONFLICT: --u-haul cannot be combined with --delegate");
  }

  const uHaulPrecedence = parseUHaulPrecedencePrimary(input.uHaulPrecedence);

  if (input.uHaul) {
    const uHaul = await (dependencies?.runUHaul ?? runUHaulInitFlow)({
      cwd: context.cwd,
      force: input.force,
      precedencePrimary: uHaulPrecedence,
    });
    const hasApplyErrors = uHaul.apply.errorDiagnostics > 0;

    return {
      family: "init",
      command: "init",
      ok: !hasApplyErrors,
      diagnostics: hasApplyErrors
        ? [
            {
              code: "INIT_U_HAUL_APPLY_FAILED",
              severity: "error",
              message: "U-Haul imported sources, but apply reported error diagnostics.",
            },
          ]
        : [],
      exitCode: hasApplyErrors ? 1 : 0,
      data: {
        force: input.force,
        uHaul,
        message: hasApplyErrors
          ? uHaul.noOp
            ? "Initialized .harness workspace. U-Haul found no legacy assets to import, but apply reported errors."
            : "Initialized .harness workspace and completed U-Haul legacy import, but apply reported errors."
          : uHaul.noOp
            ? "Initialized .harness workspace. U-Haul found no legacy assets to import."
            : "Initialized .harness workspace and completed U-Haul legacy import.",
      },
    };
  }

  let delegateProvider: ReturnType<typeof providerIdSchema.parse> | undefined;
  if (input.delegate) {
    const parsed = providerIdSchema.safeParse(input.delegate);
    if (!parsed.success) {
      throw new Error(
        `INIT_DELEGATE_INVALID_PROVIDER: '${input.delegate}' is not a valid provider (${providerIdSchema.options.join(", ")})`,
      );
    }
    delegateProvider = parsed.data;
  }
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
