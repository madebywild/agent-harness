import type { CliEnvelope, CommandOutput } from "../contracts.js";

export function toJsonEnvelope(
  output: CommandOutput,
  input: { cwd: string; durationMs: number },
): CliEnvelope<unknown> {
  return {
    schemaVersion: "1",
    ok: output.ok,
    command: output.command,
    data: output.data,
    diagnostics: output.diagnostics,
    meta: {
      cwd: input.cwd,
      durationMs: input.durationMs,
    },
  };
}

export function renderJsonOutput(output: CommandOutput, input: { cwd: string; durationMs: number }): string {
  return JSON.stringify(toJsonEnvelope(output, input), null, 2);
}
