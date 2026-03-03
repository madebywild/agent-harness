import type { ProviderAdapter } from "../types.js";
import { normalizeRelativePath } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
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
