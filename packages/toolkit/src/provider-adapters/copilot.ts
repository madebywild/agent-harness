import type { ProviderAdapter } from "../types.js";
import { normalizeRelativePath, uniqSorted } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { renderCopilotHookConfig, resolveHookTargetPath } from "./hooks.js";
import { createJsonMcpRenderer } from "./renderers.js";
import { parseCopilotSubagentOptions, renderSubagentMarkdown } from "./subagents.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const COPILOT_DEFINITION: ProviderDefinition = {
  id: "copilot",
  defaults: PROVIDER_DEFAULTS.copilot,
  mcpRenderer: createJsonMcpRenderer("servers"),
};

export function buildCopilotAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  const base = createProviderAdapter(COPILOT_DEFINITION, skillFilesByEntityId);
  return {
    ...base,
    async renderHooks(input, overrideByEntity) {
      const enabledHooks = input.filter((entry) => overrideByEntity?.get(entry.id)?.enabled !== false);
      if (enabledHooks.length === 0) {
        return [];
      }

      const targetPath = resolveHookTargetPath(
        "copilot",
        PROVIDER_DEFAULTS.copilot.hookTarget,
        enabledHooks.map((entry) => entry.id),
        overrideByEntity,
      );

      return [
        {
          path: targetPath,
          content: renderCopilotHookConfig(enabledHooks),
          ownerEntityId: uniqSorted(enabledHooks.map((entry) => entry.id)).join(","),
          provider: "copilot",
          format: "json",
        },
      ];
    },
    async renderSubagent(input, override) {
      if (override?.enabled === false) {
        return [];
      }

      const targetPath = normalizeRelativePath(override?.targetPath ?? `.github/agents/${input.id}.agent.md`);
      const options = parseCopilotSubagentOptions(override);
      return [
        {
          path: targetPath,
          content: renderSubagentMarkdown(input, {
            tools: options.tools,
            model: options.model,
            handoffs: options.handoffs,
          }),
          ownerEntityId: input.id,
          provider: "copilot",
          format: "markdown",
        },
      ];
    },
  };
}
