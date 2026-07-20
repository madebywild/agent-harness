import type { CanonicalMcpConfig } from "../types.js";
import { deepEqual } from "../utils.js";

export function mergeMcpServers(configs: ReadonlyArray<CanonicalMcpConfig>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const config of configs) {
    const servers = extractServers(config.json);
    for (const [serverId, rawServerValue] of Object.entries(servers)) {
      const serverValue = normalizeMcpServerUrlField(rawServerValue);
      if (serverId in merged && !deepEqual(merged[serverId], serverValue)) {
        throw new Error(`MCP server '${serverId}' has conflicting definitions across configs`);
      }
      merged[serverId] = serverValue;
    }
  }

  return Object.fromEntries(Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)));
}

// Every supported provider reads the remote-server endpoint from `url`; `serverUrl` is a legacy alias rewritten here.
export function normalizeMcpServerUrlField(server: unknown): unknown {
  if (!server || typeof server !== "object" || Array.isArray(server) || !Object.hasOwn(server, "serverUrl")) {
    return server;
  }

  const { serverUrl, ...rest } = server as Record<string, unknown>;
  return Object.hasOwn(rest, "url") ? rest : { ...rest, url: serverUrl };
}

export function normalizeMcpServersUrlField(servers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(servers).map(([serverId, server]) => [serverId, normalizeMcpServerUrlField(server)] as const),
  );
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
