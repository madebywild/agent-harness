import path from "node:path";
import type { ProviderId } from "./types.js";

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
  subagentDir: string;
  hookDir: string;
  commandDir: string;
  envFile: string;
  rootEnvFile: string;
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
    subagentDir: path.join(srcDir, "subagents"),
    hookDir: path.join(srcDir, "hooks"),
    commandDir: path.join(srcDir, "commands"),
    envFile: path.join(harnessDir, ".env"),
    rootEnvFile: path.join(rootDir, ".env.harness"),
  };
}

export const DEFAULT_PROMPT_SOURCE_PATH = ".harness/src/prompts/system.md";

export function defaultPromptOverridePath(provider: ProviderId): string {
  return `.harness/src/prompts/system.overrides.${provider}.yaml`;
}

export function defaultSkillSourcePath(skillId: string): string {
  return `.harness/src/skills/${skillId}/SKILL.md`;
}

export function defaultSkillOverridePath(skillId: string, provider: ProviderId): string {
  return `.harness/src/skills/${skillId}/OVERRIDES.${provider}.yaml`;
}

export function defaultMcpSourcePath(id: string): string {
  return `.harness/src/mcp/${id}.json`;
}

export function defaultMcpOverridePath(id: string, provider: ProviderId): string {
  return `.harness/src/mcp/${id}.overrides.${provider}.yaml`;
}

export function defaultSubagentSourcePath(id: string): string {
  return `.harness/src/subagents/${id}.md`;
}

export function defaultSubagentOverridePath(id: string, provider: ProviderId): string {
  return `.harness/src/subagents/${id}.overrides.${provider}.yaml`;
}

export function defaultHookSourcePath(id: string): string {
  return `.harness/src/hooks/${id}.json`;
}

export function defaultHookOverridePath(id: string, provider: ProviderId): string {
  return `.harness/src/hooks/${id}.overrides.${provider}.yaml`;
}

export function defaultCommandSourcePath(id: string): string {
  return `.harness/src/commands/${id}.md`;
}

export function defaultCommandOverridePath(id: string, provider: ProviderId): string {
  return `.harness/src/commands/${id}.overrides.${provider}.yaml`;
}
