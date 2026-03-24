import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, SkillsOutput } from "../contracts.js";

export async function handleSkillFind(input: { query: string }, context: CliResolvedContext): Promise<SkillsOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.findSkills(input.query);
  const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    family: "skills",
    command: "skill.find",
    ok: !hasErrors,
    diagnostics: result.diagnostics,
    exitCode: hasErrors ? 1 : 0,
    data: {
      operation: "find",
      query: result.query,
      results: result.results,
      rawText: result.rawText,
    },
  };
}

export async function handleSkillImport(
  input: {
    source: string;
    upstreamSkill: string;
    as?: string;
    replace?: boolean;
    allowUnsafe?: boolean;
    allowUnaudited?: boolean;
  },
  context: CliResolvedContext,
): Promise<SkillsOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.importSkill({
    source: input.source,
    upstreamSkill: input.upstreamSkill,
    as: input.as,
    replace: input.replace,
    allowUnsafe: input.allowUnsafe,
    allowUnaudited: input.allowUnaudited,
  });

  const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    family: "skills",
    command: "skill.import",
    ok: !hasErrors,
    diagnostics: result.diagnostics,
    exitCode: hasErrors ? 1 : 0,
    data: {
      operation: "import",
      result,
    },
  };
}
