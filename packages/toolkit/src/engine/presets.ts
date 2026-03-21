import { DEFAULT_REGISTRY_ID, type ProviderId, type RegistryDefinition } from "@madebywild/agent-harness-manifest";
import { fetchEntityFromRegistry } from "../entity-registries.js";
import { resolveHarnessPaths } from "../paths.js";
import { summarizePreset } from "../presets.js";
import { writeManifest } from "../repository.js";
import type { AgentsManifest, PresetApplyResult, PresetOperationResult, ResolvedPreset } from "../types.js";
import { deepEqual, sha256, stableStringify, uniqSorted } from "../utils.js";
import {
  addCommandEntity,
  addCommandEntityFromText,
  addHookEntity,
  addHookEntityFromJson,
  addMcpEntity,
  addMcpEntityFromJson,
  addPromptEntity,
  addPromptEntityFromText,
  addSettingsEntity,
  addSettingsEntityFromPayload,
  addSkillEntity,
  addSkillEntityFromFiles,
  addSubagentEntity,
  addSubagentEntityFromText,
  readCurrentSourceSha,
} from "./entities.js";
import { readManifestOrThrow } from "./state.js";
import { computeSkillSourceSha } from "./utils.js";

export async function applyResolvedPreset(cwd: string, preset: ResolvedPreset): Promise<PresetApplyResult> {
  const paths = resolveHarnessPaths(cwd);
  let manifest = await readManifestOrThrow(paths);
  const results: PresetOperationResult[] = [];

  for (const operation of preset.definition.operations) {
    switch (operation.type) {
      case "register_registry": {
        const existing = manifest.registries.entries[operation.registry];
        if (!existing) {
          manifest.registries.entries[operation.registry] = operation.definition;
          await writeManifest(paths, manifest);
          results.push({
            type: operation.type,
            target: operation.registry,
            outcome: "applied",
            message: `Registered registry '${operation.registry}'.`,
          });
        } else if (deepEqual(existing, operation.definition)) {
          results.push({
            type: operation.type,
            target: operation.registry,
            outcome: "skipped",
            message: `Registry '${operation.registry}' already exists with the same definition.`,
          });
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
          results.push({
            type: operation.type,
            target: operation.provider,
            outcome: "skipped",
            message: `Provider '${operation.provider}' is already enabled.`,
          });
          break;
        }

        manifest.providers.enabled = uniqSorted([...manifest.providers.enabled, operation.provider]) as ProviderId[];
        await writeManifest(paths, manifest);
        results.push({
          type: operation.type,
          target: operation.provider,
          outcome: "applied",
          message: `Enabled provider '${operation.provider}'.`,
        });
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_prompt": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "prompt");
        const desiredSourceSha = await resolveDesiredPromptSha(manifest, preset, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(cwd, existing, desiredRegistry, desiredSourceSha, "prompt:system");
          results.push(
            skipResult(operation.type, "prompt:system", "Prompt entity already exists with matching content."),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addPromptEntity(cwd, { registry: desiredRegistry });
        } else {
          await addPromptEntityFromText(cwd, requireEmbeddedPrompt(preset));
        }
        results.push(appliedResult(operation.type, "prompt:system", "Added prompt entity 'system'."));
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_skill": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "skill" && entity.id === operation.id);
        const desiredSourceSha = await resolveDesiredSkillSha(manifest, preset, operation.id, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(
            cwd,
            existing,
            desiredRegistry,
            desiredSourceSha,
            `skill:${operation.id}`,
          );
          results.push(
            skipResult(
              operation.type,
              `skill:${operation.id}`,
              `Skill '${operation.id}' already exists with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addSkillEntity(cwd, operation.id, { registry: desiredRegistry });
        } else {
          await addSkillEntityFromFiles(cwd, operation.id, requireEmbeddedSkill(preset, operation.id));
        }
        results.push(appliedResult(operation.type, `skill:${operation.id}`, `Added skill '${operation.id}'.`));
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_mcp": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "mcp_config" && entity.id === operation.id);
        const desiredSourceSha = await resolveDesiredMcpSha(manifest, preset, operation.id, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(cwd, existing, desiredRegistry, desiredSourceSha, `mcp:${operation.id}`);
          results.push(
            skipResult(
              operation.type,
              `mcp:${operation.id}`,
              `MCP config '${operation.id}' already exists with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addMcpEntity(cwd, operation.id, { registry: desiredRegistry });
        } else {
          await addMcpEntityFromJson(cwd, operation.id, requireEmbeddedMcp(preset, operation.id));
        }
        results.push(appliedResult(operation.type, `mcp:${operation.id}`, `Added MCP config '${operation.id}'.`));
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_subagent": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "subagent" && entity.id === operation.id);
        const desiredSourceSha = await resolveDesiredSubagentSha(manifest, preset, operation.id, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(
            cwd,
            existing,
            desiredRegistry,
            desiredSourceSha,
            `subagent:${operation.id}`,
          );
          results.push(
            skipResult(
              operation.type,
              `subagent:${operation.id}`,
              `Subagent '${operation.id}' already exists with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addSubagentEntity(cwd, operation.id, { registry: desiredRegistry });
        } else {
          await addSubagentEntityFromText(cwd, operation.id, requireEmbeddedSubagent(preset, operation.id));
        }
        results.push(appliedResult(operation.type, `subagent:${operation.id}`, `Added subagent '${operation.id}'.`));
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_hook": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "hook" && entity.id === operation.id);
        const desiredSourceSha = await resolveDesiredHookSha(manifest, preset, operation.id, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(
            cwd,
            existing,
            desiredRegistry,
            desiredSourceSha,
            `hook:${operation.id}`,
          );
          results.push(
            skipResult(
              operation.type,
              `hook:${operation.id}`,
              `Hook '${operation.id}' already exists with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addHookEntity(cwd, operation.id, { registry: desiredRegistry });
        } else {
          await addHookEntityFromJson(cwd, operation.id, requireEmbeddedHook(preset, operation.id));
        }
        results.push(appliedResult(operation.type, `hook:${operation.id}`, `Added hook '${operation.id}'.`));
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_settings": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find(
          (entity) => entity.type === "settings" && entity.id === operation.provider,
        );
        const desiredSourceSha = await resolveDesiredSettingsSha(manifest, preset, operation.provider, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(
            cwd,
            existing,
            desiredRegistry,
            desiredSourceSha,
            `settings:${operation.provider}`,
          );
          results.push(
            skipResult(
              operation.type,
              `settings:${operation.provider}`,
              `Settings '${operation.provider}' already exist with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addSettingsEntity(cwd, operation.provider, { registry: desiredRegistry });
        } else {
          await addSettingsEntityFromPayload(
            cwd,
            operation.provider,
            requireEmbeddedSettings(preset, operation.provider),
          );
        }
        results.push(
          appliedResult(operation.type, `settings:${operation.provider}`, `Added settings '${operation.provider}'.`),
        );
        manifest = await readManifestOrThrow(paths);
        break;
      }
      case "add_command": {
        const desiredRegistry = operation.source?.registry ?? DEFAULT_REGISTRY_ID;
        const existing = manifest.entities.find((entity) => entity.type === "command" && entity.id === operation.id);
        const desiredSourceSha = await resolveDesiredCommandSha(manifest, preset, operation.id, desiredRegistry);
        if (existing) {
          await assertExistingEntityCompatible(
            cwd,
            existing,
            desiredRegistry,
            desiredSourceSha,
            `command:${operation.id}`,
          );
          results.push(
            skipResult(
              operation.type,
              `command:${operation.id}`,
              `Command '${operation.id}' already exists with matching content.`,
            ),
          );
          break;
        }

        if (desiredRegistry !== DEFAULT_REGISTRY_ID) {
          await addCommandEntity(cwd, operation.id, { registry: desiredRegistry });
        } else {
          await addCommandEntityFromText(cwd, operation.id, requireEmbeddedCommand(preset, operation.id));
        }
        results.push(appliedResult(operation.type, `command:${operation.id}`, `Added command '${operation.id}'.`));
        manifest = await readManifestOrThrow(paths);
        break;
      }
    }
  }

  return {
    preset: summarizePreset(preset),
    results,
  };
}

function appliedResult(type: PresetOperationResult["type"], target: string, message: string): PresetOperationResult {
  return { type, target, outcome: "applied", message };
}

function skipResult(type: PresetOperationResult["type"], target: string, message: string): PresetOperationResult {
  return { type, target, outcome: "skipped", message };
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

async function resolveDesiredPromptSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(
      registry,
      resolveRegistryDefinition(manifest, registry),
      "prompt",
      "system",
    );
    return fetched.importedSourceSha256;
  }

  return sha256(requireEmbeddedPrompt(preset));
}

async function resolveDesiredSkillSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  id: string,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(registry, resolveRegistryDefinition(manifest, registry), "skill", id);
    return fetched.importedSourceSha256;
  }

  const files = requireEmbeddedSkill(preset, id);
  return computeSkillSourceSha(files.map((file) => ({ path: file.path, sha256: sha256(file.content) })));
}

async function resolveDesiredMcpSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  id: string,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(
      registry,
      resolveRegistryDefinition(manifest, registry),
      "mcp_config",
      id,
    );
    return fetched.importedSourceSha256;
  }

  return sha256(stableStringify(requireEmbeddedMcp(preset, id)));
}

async function resolveDesiredSubagentSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  id: string,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(
      registry,
      resolveRegistryDefinition(manifest, registry),
      "subagent",
      id,
    );
    return fetched.importedSourceSha256;
  }

  return sha256(requireEmbeddedSubagent(preset, id));
}

async function resolveDesiredHookSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  id: string,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(registry, resolveRegistryDefinition(manifest, registry), "hook", id);
    return fetched.importedSourceSha256;
  }

  return sha256(stableStringify(requireEmbeddedHook(preset, id)));
}

async function resolveDesiredSettingsSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  provider: ProviderId,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(
      registry,
      resolveRegistryDefinition(manifest, registry),
      "settings",
      provider,
    );
    return fetched.importedSourceSha256;
  }

  return sha256(stableStringify(requireEmbeddedSettings(preset, provider)));
}

async function resolveDesiredCommandSha(
  manifest: AgentsManifest,
  preset: ResolvedPreset,
  id: string,
  registry: string,
): Promise<string> {
  if (registry !== DEFAULT_REGISTRY_ID) {
    const fetched = await fetchEntityFromRegistry(
      registry,
      resolveRegistryDefinition(manifest, registry),
      "command",
      id,
    );
    return fetched.importedSourceSha256;
  }

  return sha256(requireEmbeddedCommand(preset, id));
}

function resolveRegistryDefinition(manifest: AgentsManifest, registry: string): RegistryDefinition {
  const definition = manifest.registries.entries[registry];
  if (!definition) {
    throw new Error(`REGISTRY_NOT_FOUND: registry '${registry}' is not configured`);
  }
  return definition;
}

function requireEmbeddedPrompt(preset: ResolvedPreset): string {
  if (!preset.content.prompt) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded prompt content`);
  }
  return preset.content.prompt;
}

function requireEmbeddedSkill(preset: ResolvedPreset, id: string): Array<{ path: string; content: string }> {
  const files = preset.content.skills?.[id];
  if (!files || files.length === 0) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded skill '${id}'`);
  }
  return files;
}

function requireEmbeddedMcp(preset: ResolvedPreset, id: string): Record<string, unknown> {
  const value = preset.content.mcp?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded MCP config '${id}'`);
  }
  return value;
}

function requireEmbeddedSubagent(preset: ResolvedPreset, id: string): string {
  const value = preset.content.subagents?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded subagent '${id}'`);
  }
  return value;
}

function requireEmbeddedHook(preset: ResolvedPreset, id: string): Record<string, unknown> {
  const value = preset.content.hooks?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded hook '${id}'`);
  }
  return value;
}

function requireEmbeddedSettings(preset: ResolvedPreset, provider: ProviderId): Record<string, unknown> {
  const value = preset.content.settings?.[provider];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded settings '${provider}'`);
  }
  return value;
}

function requireEmbeddedCommand(preset: ResolvedPreset, id: string): string {
  const value = preset.content.commands?.[id];
  if (!value) {
    throw new Error(`PRESET_INVALID: preset '${preset.definition.id}' is missing embedded command '${id}'`);
  }
  return value;
}
