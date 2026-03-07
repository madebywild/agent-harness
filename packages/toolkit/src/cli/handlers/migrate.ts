import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, MigrateOutput } from "../contracts.js";

export async function handleMigrate(
  input: {
    to: string;
    dryRun: boolean;
  },
  context: CliResolvedContext,
): Promise<MigrateOutput> {
  if (input.to !== "latest") {
    throw new Error("--to currently supports only 'latest'");
  }

  const engine = new HarnessEngine(context.cwd);
  const result = await engine.migrate({
    to: "latest",
    dryRun: input.dryRun,
  });

  return {
    family: "migrate",
    command: "migrate",
    ok: result.success,
    diagnostics: result.diagnostics,
    exitCode: result.success ? 0 : 1,
    data: {
      result,
    },
  };
}
