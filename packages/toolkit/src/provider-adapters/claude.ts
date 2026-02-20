import type { ProviderAdapter } from "../types.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { createJsonMcpRenderer } from "./renderers.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const CLAUDE_DEFINITION: ProviderDefinition = {
  id: "claude",
  defaults: PROVIDER_DEFAULTS.claude,
  mcpRenderer: createJsonMcpRenderer("mcpServers"),
};

export function buildClaudeAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  return createProviderAdapter(CLAUDE_DEFINITION, skillFilesByEntityId);
}
