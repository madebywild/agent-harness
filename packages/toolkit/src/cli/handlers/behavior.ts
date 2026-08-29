import { HarnessEngine } from "../../engine.js";
import type { BehaviorOutput, BehaviorShowEntry, CliResolvedContext } from "../contracts.js";

export async function handleBehaviorSet(
  input: { key: string; value: string },
  context: CliResolvedContext,
): Promise<BehaviorOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.behaviorSet(input.key, input.value);

  return {
    family: "behavior",
    command: "behavior.set",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "set",
      key: result.key,
      value: result.value,
      message: result.message,
    },
  };
}

export async function handleBehaviorShow(context: CliResolvedContext): Promise<BehaviorOutput> {
  const engine = new HarnessEngine(context.cwd);
  const behavior = await engine.behaviorShow();

  const entries: BehaviorShowEntry[] = [...behavior.choices.entries()].map(([key, choice]) => ({
    key,
    value: choice.value,
    source: choice.source,
    allowed: choice.allowed,
    instruction: choice.instruction,
  }));

  const hasErrors = behavior.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    family: "behavior",
    command: "behavior.show",
    ok: !hasErrors,
    diagnostics: behavior.diagnostics,
    exitCode: hasErrors ? 1 : 0,
    data: {
      operation: "show",
      entries,
    },
  };
}
