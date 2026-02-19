import * as TOML from "@iarna/toml";
import type { ProviderId, ProviderOverride, RenderedArtifact } from "./types.js";
import type { CanonicalMcpConfig, CanonicalPrompt, CanonicalSkill, LoadedSkillFile, ProviderAdapter } from "./types.js";
import { deepEqual, normalizeRelativePath, stableStringify, withSingleTrailingNewline } from "./utils.js";

const DEFAULT_PROMPT_TARGET: Record<ProviderId, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md"
};

const DEFAULT_SKILL_ROOT: Record<ProviderId, string> = {
  codex: ".codex/skills",
  claude: ".claude/skills",
  copilot: ".github/skills"
};

const DEFAULT_MCP_TARGET: Record<ProviderId, string> = {
  codex: ".codex/config.toml",
  claude: ".mcp.json",
  copilot: ".vscode/mcp.json"
};

export function buildBuiltinAdapters(skillFilesByEntityId: Map<string, LoadedSkillFile[]>): Record<ProviderId, ProviderAdapter> {
  return {
    codex: buildSingleAdapter("codex", skillFilesByEntityId),
    claude: buildSingleAdapter("claude", skillFilesByEntityId),
    copilot: buildSingleAdapter("copilot", skillFilesByEntityId)
  };
}

function buildSingleAdapter(provider: ProviderId, skillFilesByEntityId: Map<string, LoadedSkillFile[]>): ProviderAdapter {
  return {
    id: provider,
    async renderPrompt(input: CanonicalPrompt, override?: ProviderOverride): Promise<RenderedArtifact[]> {
      if (override?.enabled === false) {
        return [];
      }

      const artifactPath = normalizeRelativePath(override?.targetPath ?? DEFAULT_PROMPT_TARGET[provider]);
      const promptContent = withSingleTrailingNewline(input.body);

      return [
        {
          path: artifactPath,
          content: promptContent,
          ownerEntityId: input.id,
          provider,
          format: "markdown"
        }
      ];
    },

    async renderSkill(input: CanonicalSkill, override?: ProviderOverride): Promise<RenderedArtifact[]> {
      if (override?.enabled === false) {
        return [];
      }

      const files = skillFilesByEntityId.get(input.id) ?? [];
      const defaultRoot = `${DEFAULT_SKILL_ROOT[provider]}/${input.id}`;
      const targetRoot = normalizeRelativePath(override?.targetPath ?? defaultRoot);

      return files.map((file) => ({
        path: normalizeRelativePath(`${targetRoot}/${file.path}`),
        content: file.content,
        ownerEntityId: input.id,
        provider,
        format: file.path.endsWith(".json") ? "json" : "markdown"
      }));
    },

    async renderMcp(
      input: CanonicalMcpConfig[],
      overrideByEntity?: Map<string, ProviderOverride | undefined>
    ): Promise<RenderedArtifact[]> {
      const enabledSources = input.filter((entry) => {
        const override = overrideByEntity?.get(entry.id);
        return override?.enabled !== false;
      });

      if (enabledSources.length === 0) {
        return [];
      }

      const targetPath = resolveMcpTargetPath(provider, enabledSources, overrideByEntity);
      const mergedServers = mergeMcpServers(enabledSources);

      let content: string;
      let format: RenderedArtifact["format"];

      if (provider === "codex") {
        format = "toml";
        content = withSingleTrailingNewline(
          TOML.stringify({
            mcp_servers: mergedServers as unknown as TOML.AnyJson
          })
        );
      } else if (provider === "claude") {
        format = "json";
        content = stableStringify({
          mcpServers: mergedServers
        });
      } else {
        format = "json";
        content = stableStringify({
          servers: mergedServers
        });
      }

      return [
        {
          path: targetPath,
          content,
          ownerEntityId: enabledSources.map((entry) => entry.id).sort().join(","),
          provider,
          format
        }
      ];
    }
  };
}

function resolveMcpTargetPath(
  provider: ProviderId,
  configs: CanonicalMcpConfig[],
  overrideByEntity?: Map<string, ProviderOverride | undefined>
): string {
  const targets = new Set<string>();

  for (const config of configs) {
    const override = overrideByEntity?.get(config.id);
    if (override?.targetPath) {
      targets.add(normalizeRelativePath(override.targetPath));
    }
  }

  if (targets.size > 1) {
    throw new Error(
      `conflicting MCP targetPath overrides for provider '${provider}': ${[...targets].join(", ")}`
    );
  }

  if (targets.size === 1) {
    return [...targets][0] as string;
  }

  return DEFAULT_MCP_TARGET[provider];
}

function mergeMcpServers(configs: CanonicalMcpConfig[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const config of configs) {
    const servers = extractServers(config.json);
    for (const [serverId, serverValue] of Object.entries(servers)) {
      if (serverId in merged && !deepEqual(merged[serverId], serverValue)) {
        throw new Error(
          `MCP server '${serverId}' has conflicting definitions across configs`
        );
      }
      merged[serverId] = serverValue;
    }
  }

  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right))
  );
}

function extractServers(json: Record<string, unknown>): Record<string, unknown> {
  const candidate =
    (json["servers"] as Record<string, unknown> | undefined) ??
    (json["mcpServers"] as Record<string, unknown> | undefined) ??
    json;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("MCP config must be an object or contain 'servers'/'mcpServers' object");
  }

  return candidate;
}

export function getDefaultPromptTarget(provider: ProviderId): string {
  return DEFAULT_PROMPT_TARGET[provider];
}

export function getDefaultSkillRoot(provider: ProviderId): string {
  return DEFAULT_SKILL_ROOT[provider];
}

export function getDefaultMcpTarget(provider: ProviderId): string {
  return DEFAULT_MCP_TARGET[provider];
}
