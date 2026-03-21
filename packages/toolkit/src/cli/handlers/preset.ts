import { HarnessEngine } from "../../engine.js";
import type { CliResolvedContext, PresetOutput } from "../contracts.js";

export async function handlePresetList(
  input: { registry?: string },
  context: CliResolvedContext,
): Promise<PresetOutput> {
  const engine = new HarnessEngine(context.cwd);
  const presets = await engine.listPresets({ registry: input.registry });

  return {
    family: "preset",
    command: "preset.list",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "list",
      presets,
    },
  };
}

export async function handlePresetDescribe(
  input: { presetId: string; registry?: string },
  context: CliResolvedContext,
): Promise<PresetOutput> {
  const engine = new HarnessEngine(context.cwd);
  const preset = await engine.describePreset(input.presetId, { registry: input.registry });

  return {
    family: "preset",
    command: "preset.describe",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "describe",
      preset,
    },
  };
}

export async function handlePresetApply(
  input: { presetId: string; registry?: string },
  context: CliResolvedContext,
): Promise<PresetOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.applyPreset(input.presetId, { registry: input.registry });

  return {
    family: "preset",
    command: "preset.apply",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "apply",
      result,
    },
  };
}
