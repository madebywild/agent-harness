import * as TOML from "@iarna/toml";
import type { ProviderAdapter } from "../types.js";
import { deepMergeObjects, normalizeRelativePath, uniqSorted, withSingleTrailingNewline } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { resolveCodexNotifyCommand } from "./hooks.js";
import { mergeMcpServers } from "./mcp.js";
import { parseCodexSubagentOptions } from "./subagents.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const CODEX_DEFINITION: ProviderDefinition = {
  id: "codex",
  defaults: PROVIDER_DEFAULTS.codex,
  mcpRenderer: {
    format: "toml",
    render(servers) {
      return withSingleTrailingNewline(
        TOML.stringify({
          mcp_servers: servers as unknown as TOML.AnyJson,
        }),
      );
    },
  },
};

export function buildCodexAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  const base = createProviderAdapter(CODEX_DEFINITION, skillFilesByEntityId);
  return {
    ...base,
    async renderProviderState(input) {
      const enabledMcps = input.mcps.filter((entry) => input.mcpOverrideByEntity?.get(entry.id)?.enabled !== false);
      const enabledSubagents = input.subagents.filter(
        (entry) => input.subagentOverrideByEntity?.get(entry.id)?.enabled !== false,
      );
      const enabledHooks = input.hooks.filter((entry) => input.hookOverrideByEntity?.get(entry.id)?.enabled !== false);
      const settingsPayload = input.settings?.payload;

      if (enabledMcps.length === 0 && enabledSubagents.length === 0 && enabledHooks.length === 0 && !settingsPayload) {
        return [];
      }

      const targetPath = resolveCodexConfigTargetPath(
        input,
        enabledMcps.map((entry) => entry.id),
        enabledSubagents,
        enabledHooks.map((entry) => entry.id),
      );
      const payload: Record<string, unknown> = {};

      if (enabledMcps.length > 0) {
        payload.mcp_servers = mergeMcpServers(enabledMcps) as unknown as TOML.AnyJson;
      }

      if (enabledSubagents.length > 0) {
        const agents = Object.fromEntries(
          enabledSubagents
            .slice()
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((subagent) => {
              const options = parseCodexSubagentOptions(input.subagentOverrideByEntity?.get(subagent.id));
              const agentState: Record<string, unknown> = {
                description: subagent.description,
                developer_instructions: subagent.body,
              };
              if (options.model) {
                agentState.model = options.model;
              }
              if (options.tools) {
                agentState.tools = options.tools;
              }
              return [subagent.id, agentState] as const;
            }),
        );
        payload.agents = agents as unknown as TOML.AnyJson;
      }

      const notifyCommand = resolveCodexNotifyCommand(enabledHooks);
      if (notifyCommand) {
        payload.notify = notifyCommand as unknown as TOML.AnyJson;
      }

      const mergedPayload = settingsPayload
        ? deepMergeObjects(payload, settingsPayload as Record<string, unknown>)
        : payload;

      if (Object.keys(mergedPayload).length === 0) {
        return [];
      }

      const ownerEntityId = uniqSorted([
        ...enabledMcps.map((entry) => entry.id),
        ...enabledSubagents.map((entry) => entry.id),
        ...enabledHooks.map((entry) => entry.id),
        ...(input.settings ? [input.settings.id] : []),
      ]).join(",");

      return [
        {
          path: targetPath,
          content: withSingleTrailingNewline(TOML.stringify(mergedPayload as unknown as TOML.JsonMap)),
          ownerEntityId,
          provider: "codex",
          format: "toml",
        },
      ];
    },
  };
}

function resolveCodexConfigTargetPath(
  input: Parameters<NonNullable<ProviderAdapter["renderProviderState"]>>[0],
  enabledMcpIds: string[],
  enabledSubagents: Array<{ id: string }>,
  enabledHookIds: string[],
): string {
  const targets = new Set<string>();

  for (const id of enabledMcpIds) {
    const targetPath = input.mcpOverrideByEntity?.get(id)?.targetPath;
    if (targetPath) {
      targets.add(normalizeRelativePath(targetPath));
    }
  }

  for (const subagent of enabledSubagents) {
    const targetPath = input.subagentOverrideByEntity?.get(subagent.id)?.targetPath;
    if (targetPath) {
      targets.add(normalizeRelativePath(targetPath));
    }
  }

  for (const hookId of enabledHookIds) {
    const targetPath = input.hookOverrideByEntity?.get(hookId)?.targetPath;
    if (targetPath) {
      targets.add(normalizeRelativePath(targetPath));
    }
  }

  if (targets.size > 1) {
    throw new Error(
      `CODEX_CONFIG_TARGET_CONFLICT: conflicting codex config targetPath overrides: ${[...targets].join(", ")}`,
    );
  }

  if (targets.size === 1) {
    return [...targets][0] as string;
  }

  return normalizeRelativePath(PROVIDER_DEFAULTS.codex.mcpTarget);
}
