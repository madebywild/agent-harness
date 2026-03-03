import { HarnessEngine } from "../../engine.js";
import type { ApplyOutput, CliResolvedContext } from "../contracts.js";

export async function handleApply(context: CliResolvedContext): Promise<ApplyOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.apply();
  const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    family: "apply",
    command: "apply",
    ok: !hasErrors,
    diagnostics: result.diagnostics,
    exitCode: hasErrors ? 1 : 0,
    data: {
      result,
    },
  };
}
