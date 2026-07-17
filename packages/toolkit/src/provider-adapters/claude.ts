import type { CanonicalCommand, CanonicalHook, ProviderAdapter } from "../types.js";
import {
  deepMergeObjects,
  normalizeRelativePath,
  stableStringify,
  uniqSorted,
  withSingleTrailingNewline,
} from "../utils.js";
import { isNestable, PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { renderClaudeHookSettings } from "./hooks.js";
import { groupByOutputPath, resolveOutputPath } from "./paths.js";
import { createJsonMcpRenderer } from "./renderers.js";
import { parseClaudeSubagentOptions, renderSubagentMarkdown } from "./subagents.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const CLAUDE_DEFINITION: ProviderDefinition = {
  id: "claude",
  defaults: PROVIDER_DEFAULTS.claude,
  mcpRenderer: createJsonMcpRenderer("mcpServers"),
};

export function buildClaudeAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  const base = createProviderAdapter(CLAUDE_DEFINITION, skillFilesByEntityId);
  return {
    ...base,
    async renderProviderState(input) {
      const artifacts: Awaited<ReturnType<NonNullable<ProviderAdapter["renderProviderState"]>>> = [];
      const enabledMcps = input.mcps.filter((entry) => input.mcpOverrideByEntity?.get(entry.id)?.enabled !== false);
      const enabledHooks = input.hooks.filter((entry) => input.hookOverrideByEntity?.get(entry.id)?.enabled !== false);
      const settingsPayload = input.settings?.payload;
      if (enabledMcps.length === 0 && enabledHooks.length === 0 && !settingsPayload) {
        return [];
      }

      // MCP: one `.mcp.json` per target group — identical to every provider's base renderMcp.
      artifacts.push(...((await base.renderMcp?.(input.mcps, input.mcpOverrideByEntity)) ?? []));

      // settings.json: hooks grouped by target; the settings-entity payload rides the root file
      // (settings entities are root-only, so they never carry a target of their own).
      const rootSettingsPath = normalizeRelativePath(PROVIDER_DEFAULTS.claude.hookTarget);
      const hookGroups: Map<string, CanonicalHook[]> =
        enabledHooks.length > 0
          ? groupByOutputPath(enabledHooks, "claude", "hook", PROVIDER_DEFAULTS.claude.hookTarget, (id) =>
              input.hookOverrideByEntity?.get(id),
            )
          : new Map();
      if (settingsPayload && !hookGroups.has(rootSettingsPath)) {
        hookGroups.set(rootSettingsPath, []);
      }

      for (const [settingsTargetPath, hooks] of [...hookGroups.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const hookPayload =
          hooks.length === 0 ? {} : (JSON.parse(renderClaudeHookSettings(hooks)) as Record<string, unknown>);
        const includeSettings = settingsTargetPath === rootSettingsPath && settingsPayload;
        const mergedPayload = includeSettings
          ? deepMergeObjects(hookPayload, settingsPayload as Record<string, unknown>)
          : hookPayload;

        if (Object.keys(mergedPayload).length > 0) {
          artifacts.push({
            path: settingsTargetPath,
            content: stableStringify(mergedPayload),
            ownerEntityId: uniqSorted([
              ...hooks.map((entry) => entry.id),
              ...(includeSettings && input.settings ? [input.settings.id] : []),
            ]).join(","),
            provider: "claude",
            format: "json",
          });
        }
      }

      return artifacts;
    },
    async renderSubagent(input, override) {
      if (override?.enabled === false) {
        return [];
      }

      const targetPath = resolveOutputPath({
        nestable: isNestable("claude", "subagent"),
        target: input.target,
        targetPath: override?.targetPath,
        defaultRelative: `.claude/agents/${input.id}.md`,
      });
      const options = parseClaudeSubagentOptions(override);
      return [
        {
          path: targetPath,
          content: renderSubagentMarkdown(input, {
            tools: options.tools,
            model: options.model,
            disallowedTools: options.disallowedTools,
            permissionMode: options.permissionMode,
            mcpServers: options.mcpServers,
            maxTurns: options.maxTurns,
          }),
          ownerEntityId: input.id,
          provider: "claude",
          format: "markdown",
        },
      ];
    },
    async renderCommand(input, override) {
      if (override?.enabled === false) {
        return [];
      }

      const targetPath = resolveOutputPath({
        nestable: isNestable("claude", "command"),
        target: input.target,
        targetPath: override?.targetPath,
        defaultRelative: `${PROVIDER_DEFAULTS.claude.commandRoot}/${input.id}.md`,
      });
      return [
        {
          path: targetPath,
          content: renderClaudeCommandMarkdown(input),
          ownerEntityId: input.id,
          provider: "claude",
          format: "markdown",
        },
      ];
    },
  };
}

function renderClaudeCommandMarkdown(input: CanonicalCommand): string {
  const frontmatterLines = [`description: ${JSON.stringify(input.description)}`];
  if (input.argumentHint) {
    frontmatterLines.push(`argument-hint: ${JSON.stringify(input.argumentHint)}`);
  }
  const parts = ["---", ...frontmatterLines, "---"];
  if (input.body) {
    parts.push("", input.body);
  }
  return withSingleTrailingNewline(parts.join("\n"));
}
