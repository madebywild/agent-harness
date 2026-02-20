import type { CanonicalMcpConfig, ProviderId, ProviderOverride } from "../types.js";
import { deepEqual, normalizeRelativePath } from "../utils.js";

export function resolveMcpTargetPath(
  provider: ProviderId,
  defaultTargetPath: string,
  configs: ReadonlyArray<CanonicalMcpConfig>,
  overrideByEntity?: ReadonlyMap<string, ProviderOverride | undefined>,
): string {
  const targets = new Set<string>();

  for (const config of configs) {
    const override = overrideByEntity?.get(config.id);
    if (override?.targetPath) {
      targets.add(normalizeRelativePath(override.targetPath));
    }
  }

  if (targets.size > 1) {
    throw new Error(`conflicting MCP targetPath overrides for provider '${provider}': ${[...targets].join(", ")}`);
  }

  if (targets.size === 1) {
    return [...targets][0] as string;
  }

  return normalizeRelativePath(defaultTargetPath);
}

export function mergeMcpServers(configs: ReadonlyArray<CanonicalMcpConfig>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const config of configs) {
    const servers = extractServers(config.json);
    for (const [serverId, serverValue] of Object.entries(servers)) {
      if (serverId in merged && !deepEqual(merged[serverId], serverValue)) {
        throw new Error(`MCP server '${serverId}' has conflicting definitions across configs`);
      }
      merged[serverId] = serverValue;
    }
  }

  return Object.fromEntries(Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)));
}

function extractServers(json: Record<string, unknown>): Record<string, unknown> {
  const candidate =
    (json.servers as Record<string, unknown> | undefined) ??
    (json.mcpServers as Record<string, unknown> | undefined) ??
    json;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("MCP config must be an object or contain 'servers'/'mcpServers' object");
  }

  return candidate;
}
