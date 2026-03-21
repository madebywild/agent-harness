import type { CanonicalCommand, ProviderAdapter } from "../types.js";
import { normalizeRelativePath, uniqSorted, withSingleTrailingNewline } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { renderClaudeHookSettings, resolveHookTargetPath } from "./hooks.js";
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
    async renderHooks(input, overrideByEntity) {
      const enabledHooks = input.filter((entry) => overrideByEntity?.get(entry.id)?.enabled !== false);
      if (enabledHooks.length === 0) {
        return [];
      }

      const targetPath = resolveHookTargetPath(
        "claude",
        PROVIDER_DEFAULTS.claude.hookTarget,
        enabledHooks.map((entry) => entry.id),
        overrideByEntity,
      );

      return [
        {
          path: targetPath,
          content: renderClaudeHookSettings(enabledHooks),
          ownerEntityId: uniqSorted(enabledHooks.map((entry) => entry.id)).join(","),
          provider: "claude",
          format: "json",
        },
      ];
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
