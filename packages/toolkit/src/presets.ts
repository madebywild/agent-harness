import fs from "node:fs/promises";
import path from "node:path";
import type { RegistryId } from "@madebywild/agent-harness-manifest";
import { lookupRegistryDefinition } from "./engine/utils.js";
import { listPresetsFromRegistry } from "./entity-registries.js";
import { resolveHarnessPaths } from "./paths.js";
import { BUILTIN_PRESETS } from "./preset-builtin.js";
import { listPresetDirectories, readPresetPackageFromDir } from "./preset-packages.js";
import type { AgentsManifest, PresetOperation, PresetSummary, ResolvedPreset, ResolvedPresetSource } from "./types.js";

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
    // Load every preset in the registry from a single checkout so an `extends` chain resolves
    // against in-memory siblings (extends is registry-only and same-registry only).
    const all = await listRegistryPresets(options.manifest, options.registry);
    const byId = new Map(all.map((entry) => [entry.definition.id, entry] as const));
    const base = byId.get(options.presetId);
    if (!base) {
      throw new Error(`PRESET_NOT_FOUND: preset '${options.presetId}' was not found`);
    }
    return resolvePresetChain(base, byId);
  }

  const builtin = BUILTIN_PRESETS.find((entry) => entry.definition.id === options.presetId);
  if (builtin) {
    assertNoExtends(builtin);
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
  const localPreset: ResolvedPreset = {
    source: "local",
    definition: loaded.definition,
    content: loaded.content,
  };
  assertNoExtends(localPreset);
  return localPreset;
}

// `extends` is only supported for registry presets (parents resolve within the same registry
// checkout). Builtin and local presets must not declare it.
function assertNoExtends(preset: ResolvedPreset): void {
  if (preset.definition.extends) {
    throw new Error(
      `PRESET_EXTENDS_UNSUPPORTED_SOURCE: preset '${preset.definition.id}' (${preset.source}) cannot use 'extends'; it is supported only for registry presets`,
    );
  }
}

const INHERITABLE_OP_TYPES = new Set<PresetOperation["type"]>(["add_skill", "add_prompt_section"]);

function operationKey(operation: PresetOperation): string {
  // Only inheritable ops (add_skill / add_prompt_section) are keyed; both carry `id`.
  return `${operation.type}:${(operation as { id: string }).id}`;
}

// Flattens a registry preset's `extends` chain: inherited add_skill / add_prompt_section operations
// are prepended parent-first (transitively), deduped by (type, id) with the nearest/child definition
// winning, and the parent's embedded skill / prompt-section files are merged forward so inherited
// embedded operations still resolve. All other operation kinds come from the child only.
function resolvePresetChain(base: ResolvedPreset, byId: Map<string, ResolvedPreset>): ResolvedPreset {
  const flat = flattenPreset(base, byId, new Set());
  return {
    ...base,
    definition: { ...base.definition, extends: undefined, operations: flat.operations },
    content: flat.content,
  };
}

function flattenPreset(
  preset: ResolvedPreset,
  byId: Map<string, ResolvedPreset>,
  visiting: ReadonlySet<string>,
): { operations: PresetOperation[]; content: ResolvedPresetSource } {
  const id = preset.definition.id;
  if (visiting.has(id)) {
    throw new Error(`PRESET_EXTENDS_CYCLE: preset '${id}' has a cyclic extends chain`);
  }

  const own = preset.definition.operations;
  const extendsId = preset.definition.extends;
  if (!extendsId) {
    return { operations: [...own], content: preset.content };
  }

  const parent = byId.get(extendsId);
  if (!parent) {
    throw new Error(`PRESET_EXTENDS_NOT_FOUND: preset '${id}' extends unknown preset '${extendsId}'`);
  }

  const parentFlat = flattenPreset(parent, byId, new Set([...visiting, id]));
  const ownKeys = new Set(own.filter((op) => INHERITABLE_OP_TYPES.has(op.type)).map(operationKey));
  const inherited = parentFlat.operations.filter(
    (op) => INHERITABLE_OP_TYPES.has(op.type) && !ownKeys.has(operationKey(op)),
  );

  return {
    operations: [...inherited, ...own],
    content: mergePresetContent(parentFlat.content, preset.content),
  };
}

function mergePresetContent(parent: ResolvedPresetSource, child: ResolvedPresetSource): ResolvedPresetSource {
  // Child keeps its own non-inheritable content (mcp/hooks/subagents/settings/commands). Only the
  // inheritable maps are merged (child wins per id).
  const merged: ResolvedPresetSource = { ...child };
  if (parent.skills || child.skills) {
    merged.skills = { ...parent.skills, ...child.skills };
  }
  if (parent.promptSections || child.promptSections) {
    merged.promptSections = { ...parent.promptSections, ...child.promptSections };
  }
  return merged;
}
