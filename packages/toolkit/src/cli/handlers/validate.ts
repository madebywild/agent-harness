import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, ValidationOutput } from "../contracts.js";

export async function handleValidate(context: CliResolvedContext): Promise<ValidationOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.validate();

  return {
    family: "validation",
    command: "validate",
    ok: result.valid,
    diagnostics: result.diagnostics,
    exitCode: result.valid ? 0 : 1,
    data: {
      result,
    },
  };
}
