import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, PlanOutput } from "../contracts.js";

export async function handlePlan(
  input: { defaultInvocation: boolean },
  context: CliResolvedContext,
): Promise<PlanOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.plan();
  const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    family: "plan",
    command: input.defaultInvocation ? "default.plan" : "plan",
    ok: !hasErrors,
    diagnostics: result.diagnostics,
    exitCode: hasErrors ? 1 : 0,
    data: {
      result,
      defaultInvocation: input.defaultInvocation,
    },
  };
}
