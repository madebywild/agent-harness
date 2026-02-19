import type { ProviderAdapter } from "../types.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { createJsonMcpRenderer } from "./renderers.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const COPILOT_DEFINITION: ProviderDefinition = {
  id: "copilot",
  defaults: PROVIDER_DEFAULTS.copilot,
  mcpRenderer: createJsonMcpRenderer("servers")
};

export function buildCopilotAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  return createProviderAdapter(COPILOT_DEFINITION, skillFilesByEntityId);
}
