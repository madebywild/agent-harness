import { providerIdSchema } from "@agent-harness/manifest-schema";
import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, ProviderOutput } from "../contracts.js";

export async function handleProviderEnable(
  input: { provider: string },
  context: CliResolvedContext,
): Promise<ProviderOutput> {
  const parsed = providerIdSchema.parse(input.provider);
  const engine = new HarnessEngine(context.cwd);
  await engine.enableProvider(parsed);

  return {
    family: "provider",
    command: "provider.enable",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      action: "enable",
      provider: parsed,
      message: `Enabled provider '${parsed}'.`,
    },
  };
}

export async function handleProviderDisable(
  input: { provider: string },
  context: CliResolvedContext,
): Promise<ProviderOutput> {
  const parsed = providerIdSchema.parse(input.provider);
  const engine = new HarnessEngine(context.cwd);
  await engine.disableProvider(parsed);

  return {
    family: "provider",
    command: "provider.disable",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      action: "disable",
      provider: parsed,
      message: `Disabled provider '${parsed}'.`,
    },
  };
}
