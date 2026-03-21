import type { CanonicalCommand, ProviderAdapter } from "../types.js";
import {
  deepMergeObjects,
  normalizeRelativePath,
  stableStringify,
  uniqSorted,
  withSingleTrailingNewline,
} from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { renderClaudeHookSettings, resolveHookTargetPath } from "./hooks.js";
import { mergeMcpServers, resolveMcpTargetPath } from "./mcp.js";
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

      if (enabledMcps.length > 0) {
        const mcpTargetPath = resolveMcpTargetPath(
          "claude",
          PROVIDER_DEFAULTS.claude.mcpTarget,
          enabledMcps,
          input.mcpOverrideByEntity,
        );
        artifacts.push({
          path: mcpTargetPath,
          content: CLAUDE_DEFINITION.mcpRenderer.render(mergeMcpServers(enabledMcps)),
          ownerEntityId: enabledMcps
            .map((entry) => entry.id)
            .sort()
            .join(","),
          provider: "claude",
          format: CLAUDE_DEFINITION.mcpRenderer.format,
        });
      }

      if (enabledHooks.length > 0 || settingsPayload) {
        const settingsTargetPath =
          enabledHooks.length === 0
            ? normalizeRelativePath(PROVIDER_DEFAULTS.claude.hookTarget)
            : resolveHookTargetPath(
                "claude",
                PROVIDER_DEFAULTS.claude.hookTarget,
                enabledHooks.map((entry) => entry.id),
                input.hookOverrideByEntity,
              );

        const hookPayload =
          enabledHooks.length === 0
            ? {}
            : (JSON.parse(renderClaudeHookSettings(enabledHooks)) as Record<string, unknown>);
        const mergedPayload = settingsPayload
          ? deepMergeObjects(hookPayload, settingsPayload as Record<string, unknown>)
          : hookPayload;

        if (Object.keys(mergedPayload).length > 0) {
          artifacts.push({
            path: settingsTargetPath,
            content: stableStringify(mergedPayload),
            ownerEntityId: uniqSorted([
              ...enabledHooks.map((entry) => entry.id),
              ...(input.settings ? [input.settings.id] : []),
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

      const targetPath = normalizeRelativePath(override?.targetPath ?? `.claude/agents/${input.id}.md`);
      const options = parseClaudeSubagentOptions(override);
      return [
        {
          path: targetPath,
          content: renderSubagentMarkdown(input, {
            tools: options.tools,
            model: options.model,
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

      const defaultTarget = `${PROVIDER_DEFAULTS.claude.commandRoot}/${input.id}.md`;
      const targetPath = normalizeRelativePath(override?.targetPath ?? defaultTarget);
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
