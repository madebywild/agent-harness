import type { LoadedSkillFile, ProviderAdapter, ProviderId } from "./types.js";
import { buildProviderAdapters } from "./provider-adapters/registry.js";
import { getProviderDefaults } from "./provider-adapters/constants.js";

export function buildBuiltinAdapters(skillFilesByEntityId: Map<string, LoadedSkillFile[]>): Record<ProviderId, ProviderAdapter> {
  return buildProviderAdapters(skillFilesByEntityId);
}

export function getDefaultPromptTarget(provider: ProviderId): string {
  return getProviderDefaults(provider).promptTarget;
}

export function getDefaultSkillRoot(provider: ProviderId): string {
  return getProviderDefaults(provider).skillRoot;
}

export function getDefaultMcpTarget(provider: ProviderId): string {
  return getProviderDefaults(provider).mcpTarget;
}
