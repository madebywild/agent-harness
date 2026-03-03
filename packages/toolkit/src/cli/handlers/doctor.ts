import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, DoctorOutput } from "../contracts.js";

export async function handleDoctor(context: CliResolvedContext): Promise<DoctorOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.doctor({ json: true });

  return {
    family: "doctor",
    command: "doctor",
    ok: result.healthy,
    diagnostics: result.diagnostics,
    exitCode: result.healthy ? 0 : 1,
    data: {
      result,
    },
  };
}
