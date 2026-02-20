import type { ProviderAdapter, ProviderId } from "../types.js";
import { buildClaudeAdapter } from "./claude.js";
import { buildCodexAdapter } from "./codex.js";
import { buildCopilotAdapter } from "./copilot.js";
import type { SkillFileIndex } from "./types.js";

export function buildProviderAdapters(skillFilesByEntityId: SkillFileIndex): Record<ProviderId, ProviderAdapter> {
  return {
    codex: buildCodexAdapter(skillFilesByEntityId),
    claude: buildClaudeAdapter(skillFilesByEntityId),
    copilot: buildCopilotAdapter(skillFilesByEntityId),
  };
}
