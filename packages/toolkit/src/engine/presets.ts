import { DEFAULT_REGISTRY_ID, type PresetOperation, type ProviderId } from "@madebywild/agent-harness-manifest";
import {
  type CheckedOutRegistry,
  checkoutRegistry,
  cleanupTempDir,
  fetchEntityFromCheckout,
} from "../entity-registries.js";
import { resolveHarnessPaths } from "../paths.js";
import { summarizePreset } from "../presets.js";
import { writeManifest } from "../repository.js";
import type { AgentsManifest, EntityType, PresetApplyResult, PresetOperationResult, ResolvedPreset } from "../types.js";
import { deepEqual, sha256, stableStringify, uniqSorted } from "../utils.js";
import {
  addCommandEntity,
  addHookEntity,
  addMcpEntity,
  addPromptSectionEntity,
  addSettingsEntity,
  addSkillEntity,
  addSubagentEntity,
  readCurrentSourceSha,
} from "./entities.js";
import { readManifestOrThrow } from "./state.js";
import { computeSkillSourceSha, lookupRegistryDefinition } from "./utils.js";

export async function applyResolvedPreset(cwd: string, preset: ResolvedPreset): Promise<PresetApplyResult> {
  const paths = resolveHarnessPaths(cwd);
  let manifest = await readManifestOrThrow(paths);
  const results: PresetOperationResult[] = [];

  // Pre-checkout each unique registry referenced by entity operations so we
  // clone at most once per registry instead of once per operation.
  const checkoutCache = new Map<string, CheckedOutRegistry>();
  try {
    for (const operation of preset.definition.operations) {
      switch (operation.type) {
        case "register_registry": {
          const existing = manifest.registries.entries[operation.registry];
          if (!existing) {
            manifest.registries.entries[operation.registry] = operation.definition;
            await writeManifest(paths, manifest);
            results.push(
              appliedResult(operation.type, operation.registry, `Registered registry '${operation.registry}'.`),
            );
          } else if (deepEqual(existing, operation.definition)) {
            results.push(
              skipResult(
                operation.type,
                operation.registry,
                `Registry '${operation.registry}' already exists with the same definition.`,
              ),
            );
          } else {
            throw new Error(
              `PRESET_CONFLICT: registry '${operation.registry}' already exists with a different definition`,
            );
          }

          manifest = await readManifestOrThrow(paths);
          break;
        }
        case "enable_provider": {
          if (manifest.providers.enabled.includes(operation.provider)) {
            results.push(
              skipResult(operation.type, operation.provider, `Provider '${operation.provider}' is already enabled.`),
            );
            break;
          }

          manifest.providers.enabled = uniqSorted([...manifest.providers.enabled, operation.provider]) as ProviderId[];
          await writeManifest(paths, manifest);
          results.push(appliedResult(operation.type, operation.provider, `Enabled provider '${operation.provider}'.`));
          manifest = await readManifestOrThrow(paths);
          break;
        }
        default: {
          const result = await applyEntityOperation(cwd, manifest, preset, operation, checkoutCache);
          results.push(result);
          manifest = await readManifestOrThrow(paths);
          break;
        }
      }
    }
  } finally {
    await Promise.all([...checkoutCache.values()].map((co) => cleanupTempDir(co.tempRoot)));
  }

  return {
    preset: summarizePreset(preset),
    results,
  };
}

// ---------------------------------------------------------------------------
// Generic entity operation handler
// ---------------------------------------------------------------------------

type EntityAddOperation = Exclude<PresetOperation, { type: "register_registry" } | { type: "enable_provider" }>;

interface EntityOperationSpec {
  entityType: EntityType;
  entityId: string;
  label: string;
  registry: string;
  resolveDesiredSha: () => Promise<string>;
}

function describeEntityOperation(operation: EntityAddOperation, preset: ResolvedPreset): EntityOperationSpec {
  switch (operation.type) {
    case "add_prompt_section":
      return {
        entityType: "prompt_section",
        entityId: operation.id,
        label: `prompt-section:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () => Promise.resolve(sha256(requireEmbeddedPromptSection(preset, operation.id))),
      };
    case "add_skill":
      return {
        entityType: "skill",
        entityId: operation.id,
        label: `skill:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () => {
          const files = requireEmbeddedSkillFiles(preset, operation.id);
          return Promise.resolve(
            computeSkillSourceSha(files.map((file) => ({ path: file.path, sha256: sha256(file.content) }))),
          );
        },
      };
    case "add_mcp":
      return {
        entityType: "mcp_config",
        entityId: operation.id,
        label: `mcp:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () => Promise.resolve(sha256(stableStringify(requireEmbedded(preset, "mcp", operation.id)))),
      };
    case "add_subagent":
      return {
        entityType: "subagent",
        entityId: operation.id,
        label: `subagent:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () => Promise.resolve(sha256(requireEmbedded(preset, "subagents", operation.id))),
      };
    case "add_hook":
      return {
        entityType: "hook",
        entityId: operation.id,
        label: `hook:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () =>
          Promise.resolve(sha256(stableStringify(requireEmbedded(preset, "hooks", operation.id)))),
      };
    case "add_settings":
      return {
        entityType: "settings",
        entityId: operation.provider,
        label: `settings:${operation.provider}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () =>
          Promise.resolve(sha256(stableStringify(requireEmbedded(preset, "settings", operation.provider)))),
      };
    case "add_command":
      return {
        entityType: "command",
        entityId: operation.id,
        label: `command:${operation.id}`,
        registry: operation.source?.registry ?? DEFAULT_REGISTRY_ID,
        resolveDesiredSha: () => Promise.resolve(sha256(requireEmbedded(preset, "commands", operation.id))),
      };
  }
}

async function applyEntityOperation(
  cwd: string,
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  operation: EntityAddOperation,
  checkoutCache: Map<string, CheckedOutRegistry>,
): Promise<PresetOperationResult> {
  const spec = describeEntityOperation(operation, preset);
  const { entityType, entityId, label, registry } = spec;

  const existing = manifest.entities.find((entity) => entity.type === entityType && entity.id === entityId);

  const desiredSha =
    registry !== DEFAULT_REGISTRY_ID
      ? await resolveRegistrySha(manifest, registry, entityType, entityId, checkoutCache)
      : await spec.resolveDesiredSha();

  if (existing) {
    await assertExistingEntityCompatible(cwd, existing, registry, desiredSha, label);
    return skipResult(
      operation.type,
      label,
      `${capitalize(entityType)} '${entityId}' already exists with matching content.`,
    );
  }

  // Third-party (registry-sourced) presets do not dictate a consumer's package layout, so any
  // declared `target` is dropped and entities scaffold at the root (Decision 11). Local and
  // built-in presets honor `target`.
  const declaredTarget = "target" in operation ? operation.target : undefined;
  const target = preset.source === "registry" ? undefined : declaredTarget;

  if (registry !== DEFAULT_REGISTRY_ID) {
    await addEntityFromRegistry(cwd, entityType, entityId, registry, target);
  } else {
    await addEntityFromEmbedded(cwd, preset, operation, target);
  }

  const droppedNote =
    declaredTarget && !target ? ` (target '${declaredTarget}' ignored for registry preset; placed at root)` : "";
  return appliedResult(operation.type, label, `Added ${entityType} '${entityId}'.${droppedNote}`);
}

// ---------------------------------------------------------------------------
// Add entity dispatchers
// ---------------------------------------------------------------------------

async function addEntityFromRegistry(
  cwd: string,
  entityType: EntityType,
  entityId: string,
  registry: string,
  target?: string,
): Promise<void> {
  switch (entityType) {
    case "prompt_section":
      return addPromptSectionEntity(cwd, entityId, { registry, target });
    case "skill":
      return addSkillEntity(cwd, entityId, { registry, target });
    case "mcp_config":
      return addMcpEntity(cwd, entityId, { registry, target });
    case "subagent":
      return addSubagentEntity(cwd, entityId, { registry, target });
    case "hook":
      return addHookEntity(cwd, entityId, { registry, target });
    case "settings":
      return addSettingsEntity(cwd, entityId as ProviderId, { registry });
    case "command":
      return addCommandEntity(cwd, entityId, { registry, target });
  }
}

async function addEntityFromEmbedded(
  cwd: string,
  preset: ResolvedPreset,
  operation: EntityAddOperation,
  target?: string,
): Promise<void> {
  switch (operation.type) {
    case "add_prompt_section":
      return addPromptSectionEntity(cwd, operation.id, {
        sourceText: requireEmbeddedPromptSection(preset, operation.id),
        target,
      });
    case "add_skill":
      return addSkillEntity(cwd, operation.id, { files: requireEmbeddedSkillFiles(preset, operation.id), target });
    case "add_mcp":
      return addMcpEntity(cwd, operation.id, { sourceJson: requireEmbedded(preset, "mcp", operation.id), target });
    case "add_subagent":
      return addSubagentEntity(cwd, operation.id, {
        sourceText: requireEmbedded(preset, "subagents", operation.id),
        target,
      });
    case "add_hook":
      return addHookEntity(cwd, operation.id, { sourceJson: requireEmbedded(preset, "hooks", operation.id), target });
    case "add_settings":
      return addSettingsEntity(cwd, operation.provider, {
        sourcePayload: requireEmbedded(preset, "settings", operation.provider),
      });
    case "add_command":
      return addCommandEntity(cwd, operation.id, {
        sourceText: requireEmbedded(preset, "commands", operation.id),
        target,
      });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appliedResult(type: PresetOperationResult["type"], target: string, message: string): PresetOperationResult {
  return { type, target, outcome: "applied", message };
}

function skipResult(type: PresetOperationResult["type"], target: string, message: string): PresetOperationResult {
  return { type, target, outcome: "skipped", message };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function assertExistingEntityCompatible(
  cwd: string,
  existing: AgentsManifest["entities"][number],
  desiredRegistry: string,
  desiredSourceSha: string,
  label: string,
): Promise<void> {
  const currentSourceSha = await readCurrentSourceSha(cwd, existing);
  if (existing.registry !== desiredRegistry || currentSourceSha !== desiredSourceSha) {
    throw new Error(`PRESET_CONFLICT: ${label} already exists with different content or provenance`);
  }
}

async function resolveRegistrySha(
  manifest: AgentsManifest,
  registry: string,
  entityType: EntityType,
  entityId: string,
  checkoutCache: Map<string, CheckedOutRegistry>,
): Promise<string> {
  let checkout = checkoutCache.get(registry);
  if (!checkout) {
    checkout = await checkoutRegistry(registry, lookupRegistryDefinition(manifest, registry));
    checkoutCache.set(registry, checkout);
  }
  const fetched = await fetchEntityFromCheckout(registry, checkout, entityType, entityId);
  return fetched.importedSourceSha256;
}

function requireEmbedded(preset: ResolvedPreset, key: "subagents" | "commands", id: string): string;
function requireEmbedded(preset: ResolvedPreset, key: "mcp" | "hooks", id: string): Record<string, unknown>;
function requireEmbedded(preset: ResolvedPreset, key: "settings", id: string): Record<string, unknown>;
function requireEmbedded(
  preset: ResolvedPreset,
  key: "subagents" | "commands" | "mcp" | "hooks" | "settings",
  id: string,
): string | Record<string, unknown> {
  // Settings uses ProviderId keys; all other maps use plain string keys.
  const value = key === "settings" ? preset.content.settings?.[id as ProviderId] : preset.content[key]?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded ${key} '${id}'`);
  }
  return value;
}

function requireEmbeddedPromptSection(preset: ResolvedPreset, id: string): string {
  const value = preset.content.promptSections?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded prompt-section '${id}'`);
  }
  return value;
}

function requireEmbeddedSkillFiles(preset: ResolvedPreset, id: string): Array<{ path: string; content: string }> {
  const files = preset.content.skills?.[id];
  if (!files || files.length === 0) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded skill '${id}'`);
  }
  return files;
}
