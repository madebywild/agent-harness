import type { ProviderId } from "../types.js";
import type { ProviderDefaults } from "./types.js";

export const PROVIDER_DEFAULTS = {
  codex: {
    promptTarget: "AGENTS.md",
    skillRoot: ".codex/skills",
    mcpTarget: ".codex/config.toml",
  },
  claude: {
    promptTarget: "CLAUDE.md",
    skillRoot: ".claude/skills",
    mcpTarget: ".mcp.json",
  },
  copilot: {
    promptTarget: ".github/copilot-instructions.md",
    skillRoot: ".github/skills",
    mcpTarget: ".vscode/mcp.json",
  },
} as const satisfies Record<ProviderId, ProviderDefaults>;

export function getProviderDefaults(provider: ProviderId): ProviderDefaults {
  return PROVIDER_DEFAULTS[provider];
}
