import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, InitOutput } from "../contracts.js";

export async function handleInit(input: { force: boolean }, context: CliResolvedContext): Promise<InitOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.init({ force: input.force });

  return {
    family: "init",
    command: "init",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      force: input.force,
      message: "Initialized .harness workspace.",
    },
  };
}
