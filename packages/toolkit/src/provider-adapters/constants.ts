import type { ProviderId } from "../types.js";
import type { ProviderDefaults } from "./types.js";

export const PROVIDER_DEFAULTS = {
  codex: {
    promptTarget: "AGENTS.md",
    skillRoot: ".codex/skills",
    mcpTarget: ".codex/config.toml",
    hookTarget: ".codex/config.toml",
  },
  claude: {
    promptTarget: "CLAUDE.md",
    skillRoot: ".claude/skills",
    mcpTarget: ".mcp.json",
    hookTarget: ".claude/settings.json",
    commandRoot: ".claude/commands",
  },
  copilot: {
    promptTarget: ".github/copilot-instructions.md",
    skillRoot: ".github/skills",
    mcpTarget: ".vscode/mcp.json",
    hookTarget: ".github/hooks/harness.generated.json",
    commandRoot: ".github/prompts",
  },
  cursor: {
    promptTarget: ".cursor/prompt.md",
    skillRoot: ".cursor/skills",
    mcpTarget: ".cursor/mcp.json",
    hookTarget: ".cursor/hooks.json",
    commandRoot: ".cursor/commands",
  },
} as const satisfies Record<ProviderId, ProviderDefaults>;

export function getProviderDefaults(provider: ProviderId): ProviderDefaults {
  return PROVIDER_DEFAULTS[provider];
}

/** Artifact families an entity can generate, for capability-aware monorepo routing. */
export type ArtifactType = "prompt" | "skill" | "subagent" | "command" | "mcp" | "hook" | "settings";

// Which artifact types each provider discovers when co-located in a subdirectory. A `target`
// on an entity relocates the artifact into the package only for the providers listed here;
// others keep it at the repo root (namespaced/aggregated) or skip it (per-entity singleton).
const PROVIDER_NESTABLE_ARTIFACTS = {
  claude: ["prompt", "skill", "subagent", "command", "mcp", "hook", "settings"],
  codex: ["prompt"],
  copilot: [],
  cursor: [],
} as const satisfies Record<ProviderId, readonly ArtifactType[]>;

const PROVIDER_NESTABLE: Record<ProviderId, ReadonlySet<ArtifactType>> = {
  claude: new Set(PROVIDER_NESTABLE_ARTIFACTS.claude),
  codex: new Set(PROVIDER_NESTABLE_ARTIFACTS.codex),
  copilot: new Set(PROVIDER_NESTABLE_ARTIFACTS.copilot),
  cursor: new Set(PROVIDER_NESTABLE_ARTIFACTS.cursor),
};

export function isNestable(provider: ProviderId, artifact: ArtifactType): boolean {
  return PROVIDER_NESTABLE[provider].has(artifact);
}

// Which artifact types each provider generates at all (mirrors the adapter render methods).
// Codex has no command artifact; cursor emits neither prompt nor command. Used to avoid
// emitting routing diagnostics for combinations that produce no file.
const PROVIDER_EMITS_ARTIFACTS = {
  claude: ["prompt", "skill", "subagent", "command", "mcp", "hook", "settings"],
  codex: ["prompt", "skill", "subagent", "mcp", "hook", "settings"],
  copilot: ["prompt", "skill", "subagent", "command", "mcp", "hook", "settings"],
  cursor: ["skill", "subagent", "mcp", "hook"],
} as const satisfies Record<ProviderId, readonly ArtifactType[]>;

const PROVIDER_EMITS: Record<ProviderId, ReadonlySet<ArtifactType>> = {
  claude: new Set(PROVIDER_EMITS_ARTIFACTS.claude),
  codex: new Set(PROVIDER_EMITS_ARTIFACTS.codex),
  copilot: new Set(PROVIDER_EMITS_ARTIFACTS.copilot),
  cursor: new Set(PROVIDER_EMITS_ARTIFACTS.cursor),
};

export function providerEmitsArtifact(provider: ProviderId, artifact: ArtifactType): boolean {
  return PROVIDER_EMITS[provider].has(artifact);
}
