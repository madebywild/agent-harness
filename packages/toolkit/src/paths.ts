import path from "node:path";
import type { ProviderId } from "./types.js";

export interface HarnessPaths {
  root: string;
  agentsDir: string;
  srcDir: string;
  importsDir: string;
  skillImportDir: string;
  presetsDir: string;
  manifestFile: string;
  lockFile: string;
  managedIndexFile: string;
  promptSectionDir: string;
  skillDir: string;
  mcpDir: string;
  subagentDir: string;
  hookDir: string;
  settingsDir: string;
  commandDir: string;
  envFile: string;
  rootEnvFile: string;
  behaviorMapFile: string;
  behaviorConfigFile: string;
}

export function resolveHarnessPaths(rootDir: string): HarnessPaths {
  const harnessDir = path.join(rootDir, ".harness");
  const srcDir = path.join(harnessDir, "src");
  const importsDir = path.join(harnessDir, "imports");
  return {
    root: rootDir,
    agentsDir: harnessDir,
    srcDir,
    importsDir,
    skillImportDir: path.join(importsDir, "skills"),
    presetsDir: path.join(harnessDir, "presets"),
    manifestFile: path.join(harnessDir, "manifest.json"),
    lockFile: path.join(harnessDir, "manifest.lock.json"),
    managedIndexFile: path.join(harnessDir, "managed-index.json"),
    promptSectionDir: path.join(srcDir, "prompt-sections"),
    skillDir: path.join(srcDir, "skills"),
    mcpDir: path.join(srcDir, "mcp"),
    subagentDir: path.join(srcDir, "subagents"),
    hookDir: path.join(srcDir, "hooks"),
    settingsDir: path.join(srcDir, "settings"),
    commandDir: path.join(srcDir, "commands"),
    envFile: path.join(harnessDir, ".env"),
    rootEnvFile: path.join(rootDir, ".env.harness"),
    behaviorMapFile: path.join(harnessDir, "behavior.map.yaml"),
    behaviorConfigFile: path.join(harnessDir, "behavior.yaml"),
  };
}

export function defaultPromptSectionSourcePath(id: string): string {
  return `.harness/src/prompt-sections/${id}/SECTION.md`;
}

export function defaultPromptSectionOverridePath(id: string, provider: ProviderId): string {
  return `.harness/src/prompt-sections/${id}/OVERRIDES.${provider}.yaml`;
}

export function defaultSkillSourcePath(skillId: string): string {
  return `.harness/src/skills/${skillId}/SKILL.md`;
}

export function defaultSkillOverridePath(skillId: string, provider: ProviderId): string {
  return `.harness/src/skills/${skillId}/OVERRIDES.${provider}.yaml`;
}

export function defaultSkillImportMetadataPath(skillId: string): string {
  return `.harness/imports/skills/${skillId}.json`;
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

export function defaultSettingsSourcePath(provider: ProviderId): string {
  if (provider === "codex") {
    return ".harness/src/settings/codex.toml";
  }

  return `.harness/src/settings/${provider}.json`;
}
