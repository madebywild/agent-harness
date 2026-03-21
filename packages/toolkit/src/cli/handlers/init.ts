import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, InitOutput } from "../contracts.js";

export async function handleInit(
  input: { force: boolean; preset?: string },
  context: CliResolvedContext,
): Promise<InitOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.init({ force: input.force });

  if (input.preset) {
    await engine.applyPreset(input.preset);
  }

  return {
    family: "init",
    command: "init",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      force: input.force,
      preset: input.preset,
      message: input.preset
        ? `Initialized .harness workspace and applied preset '${input.preset}'.`
        : "Initialized .harness workspace.",
    },
  };
}
