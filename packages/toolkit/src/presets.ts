import fs from "node:fs/promises";
import path from "node:path";
import type { RegistryId } from "@madebywild/agent-harness-manifest";
import { lookupRegistryDefinition } from "./engine/utils.js";
import { fetchPresetFromRegistry, listPresetsFromRegistry } from "./entity-registries.js";
import { resolveHarnessPaths } from "./paths.js";
import { BUILTIN_PRESETS } from "./preset-builtin.js";
import { listPresetDirectories, readPresetPackageFromDir } from "./preset-packages.js";
import type { AgentsManifest, PresetSummary, ResolvedPreset } from "./types.js";

export function summarizePreset(preset: ResolvedPreset): PresetSummary {
  return {
    id: preset.definition.id,
    name: preset.definition.name,
    description: preset.definition.description,
    recommended: preset.definition.recommended === true,
    source: preset.source,
    registry: preset.registry,
  };
}

export async function listBuiltinPresets(): Promise<ResolvedPreset[]> {
  return [...BUILTIN_PRESETS];
}

export async function listLocalPresets(cwd: string): Promise<ResolvedPreset[]> {
  const presetDirs = await listPresetDirectories(resolveHarnessPaths(cwd).presetsDir);
  const presets = await Promise.all(
    presetDirs.map(async (presetDir) => {
      const loaded = await readPresetPackageFromDir(presetDir);
      return {
        source: "local" as const,
        definition: loaded.definition,
        content: loaded.content,
      };
    }),
  );

  presets.sort((left, right) => left.definition.id.localeCompare(right.definition.id));
  return presets;
}

export async function listRegistryPresets(manifest: AgentsManifest, registryId: RegistryId): Promise<ResolvedPreset[]> {
  const definition = lookupRegistryDefinition(manifest, registryId);
  const fetched = await listPresetsFromRegistry(registryId, definition);
  return fetched.map((entry) => ({
    source: "registry" as const,
    registry: registryId,
    definition: entry.definition,
    content: entry.content,
  }));
}

export async function resolvePreset(
  cwd: string,
  options: {
    presetId: string;
    manifest?: AgentsManifest;
    registry?: RegistryId;
  },
): Promise<ResolvedPreset> {
  if (options.registry) {
    if (!options.manifest) {
      throw new Error(`REGISTRY_NOT_FOUND: registry '${options.registry}' is not configured`);
    }
    const definition = lookupRegistryDefinition(options.manifest, options.registry);
    const fetched = await fetchPresetFromRegistry(options.registry, definition, options.presetId);
    return {
      source: "registry",
      registry: options.registry,
      definition: fetched.definition,
      content: fetched.content,
    };
  }

  const builtin = BUILTIN_PRESETS.find((entry) => entry.definition.id === options.presetId);
  if (builtin) {
    return builtin;
  }

  const localPresetDir = path.join(resolveHarnessPaths(cwd).presetsDir, options.presetId);
  try {
    await fs.stat(localPresetDir);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error(`PRESET_NOT_FOUND: preset '${options.presetId}' was not found`);
    }
    throw error;
  }

  const loaded = await readPresetPackageFromDir(localPresetDir);
  return {
    source: "local",
    definition: loaded.definition,
    content: loaded.content,
  };
}
