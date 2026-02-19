import path from "node:path";

export interface HarnessPaths {
  root: string;
  agentsDir: string;
  srcDir: string;
  manifestFile: string;
  lockFile: string;
  managedIndexFile: string;
  promptDir: string;
  skillDir: string;
  mcpDir: string;
}

export function resolveHarnessPaths(rootDir: string): HarnessPaths {
  const agentsDir = path.join(rootDir, ".agents");
  const srcDir = path.join(agentsDir, "src");
  return {
    root: rootDir,
    agentsDir,
    srcDir,
    manifestFile: path.join(agentsDir, "manifest.json"),
    lockFile: path.join(agentsDir, "manifest.lock.json"),
    managedIndexFile: path.join(agentsDir, "managed-index.json"),
    promptDir: path.join(srcDir, "prompts"),
    skillDir: path.join(srcDir, "skills"),
    mcpDir: path.join(srcDir, "mcp")
  };
}

export const DEFAULT_PROMPT_SOURCE_PATH = ".agents/src/prompts/system.md";

export function defaultPromptOverridePath(provider: "codex" | "claude" | "copilot"): string {
  return `.agents/src/prompts/system.overrides.${provider}.yaml`;
}

export function defaultSkillSourcePath(skillId: string): string {
  return `.agents/src/skills/${skillId}/SKILL.md`;
}

export function defaultSkillOverridePath(skillId: string, provider: "codex" | "claude" | "copilot"): string {
  return `.agents/src/skills/${skillId}/OVERRIDES.${provider}.yaml`;
}

export function defaultMcpSourcePath(id: string): string {
  return `.agents/src/mcp/${id}.json`;
}

export function defaultMcpOverridePath(id: string, provider: "codex" | "claude" | "copilot"): string {
  return `.agents/src/mcp/${id}.overrides.${provider}.yaml`;
}
