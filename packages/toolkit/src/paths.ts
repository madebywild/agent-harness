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
  const harnessDir = path.join(rootDir, ".harness");
  const srcDir = path.join(harnessDir, "src");
  return {
    root: rootDir,
    agentsDir: harnessDir,
    srcDir,
    manifestFile: path.join(harnessDir, "manifest.json"),
    lockFile: path.join(harnessDir, "manifest.lock.json"),
    managedIndexFile: path.join(harnessDir, "managed-index.json"),
    promptDir: path.join(srcDir, "prompts"),
    skillDir: path.join(srcDir, "skills"),
    mcpDir: path.join(srcDir, "mcp"),
  };
}

export const DEFAULT_PROMPT_SOURCE_PATH = ".harness/src/prompts/system.md";

export function defaultPromptOverridePath(provider: "codex" | "claude" | "copilot"): string {
  return `.harness/src/prompts/system.overrides.${provider}.yaml`;
}

export function defaultSkillSourcePath(skillId: string): string {
  return `.harness/src/skills/${skillId}/SKILL.md`;
}

export function defaultSkillOverridePath(skillId: string, provider: "codex" | "claude" | "copilot"): string {
  return `.harness/src/skills/${skillId}/OVERRIDES.${provider}.yaml`;
}

export function defaultMcpSourcePath(id: string): string {
  return `.harness/src/mcp/${id}.json`;
}

export function defaultMcpOverridePath(id: string, provider: "codex" | "claude" | "copilot"): string {
  return `.harness/src/mcp/${id}.overrides.${provider}.yaml`;
}
