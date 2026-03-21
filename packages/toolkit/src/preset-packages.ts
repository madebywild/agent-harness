import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "@iarna/toml";
import { type PresetDefinition, parsePresetDefinition, providerIdSchema } from "@madebywild/agent-harness-manifest";
import { listFilesRecursively } from "./repository.js";
import type { ProviderId, ResolvedPresetSource } from "./types.js";
import { normalizeRelativePath, parseJsonAsRecord, parseTomlAsRecord } from "./utils.js";

export interface LoadedPresetPackage {
  definition: PresetDefinition;
  content: ResolvedPresetSource;
}

export async function readPresetPackageFromDir(presetDir: string): Promise<LoadedPresetPackage> {
  const definitionPath = path.join(presetDir, "preset.json");
  const definitionText = await fs.readFile(definitionPath, "utf8");
  const definition = parsePresetDefinition(JSON.parse(definitionText) as unknown);

  const content: ResolvedPresetSource = {};

  const promptPath = path.join(presetDir, "prompt.md");
  if (await pathExists(promptPath)) {
    content.prompt = await fs.readFile(promptPath, "utf8");
  }

  const skillsDir = path.join(presetDir, "skills");
  if (await pathExists(skillsDir)) {
    content.skills = await loadPresetSkills(skillsDir);
  }

  const mcpDir = path.join(presetDir, "mcp");
  if (await pathExists(mcpDir)) {
    content.mcp = await loadObjectFiles(mcpDir, ".json");
  }

  const subagentsDir = path.join(presetDir, "subagents");
  if (await pathExists(subagentsDir)) {
    content.subagents = await loadTextFiles(subagentsDir, ".md");
  }

  const hooksDir = path.join(presetDir, "hooks");
  if (await pathExists(hooksDir)) {
    content.hooks = await loadObjectFiles(hooksDir, ".json");
  }

  const settingsDir = path.join(presetDir, "settings");
  if (await pathExists(settingsDir)) {
    content.settings = await loadSettingsFiles(settingsDir);
  }

  const commandsDir = path.join(presetDir, "commands");
  if (await pathExists(commandsDir)) {
    content.commands = await loadTextFiles(commandsDir, ".md");
  }

  return { definition, content };
}

export async function listPresetDirectories(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function loadPresetSkills(skillsDir: string): Promise<NonNullable<ResolvedPresetSource["skills"]>> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skills: NonNullable<ResolvedPresetSource["skills"]> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillRoot = path.join(skillsDir, entry.name);
    const files = await listFilesRecursively(skillRoot);
    const loadedFiles = await Promise.all(
      files.map(async (absolutePath) => ({
        path: normalizeRelativePath(path.relative(skillRoot, absolutePath).replace(/\\/g, "/")),
        content: await fs.readFile(absolutePath, "utf8"),
      })),
    );

    loadedFiles.sort((left, right) => left.path.localeCompare(right.path));
    skills[entry.name] = loadedFiles;
  }

  return skills;
}

async function loadObjectFiles(directory: string, extension: string): Promise<Record<string, Record<string, unknown>>> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result: Record<string, Record<string, unknown>> = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue;
    }

    const id = entry.name.slice(0, -extension.length);
    const text = await fs.readFile(path.join(directory, entry.name), "utf8");
    result[id] = parseJsonAsRecord(text);
  }

  return result;
}

async function loadTextFiles(directory: string, extension: string): Promise<Record<string, string>> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue;
    }

    const id = entry.name.slice(0, -extension.length);
    result[id] = await fs.readFile(path.join(directory, entry.name), "utf8");
  }

  return result;
}

async function loadSettingsFiles(settingsDir: string): Promise<Partial<Record<ProviderId, Record<string, unknown>>>> {
  const result: Partial<Record<ProviderId, Record<string, unknown>>> = {};

  for (const provider of providerIdSchema.options) {
    const fileName = provider === "codex" ? "codex.toml" : `${provider}.json`;
    const filePath = path.join(settingsDir, fileName);
    if (!(await pathExists(filePath))) {
      continue;
    }

    const text = await fs.readFile(filePath, "utf8");
    result[provider] = provider === "codex" ? parseTomlAsRecord(text, TOML) : parseJsonAsRecord(text);
  }

  return result;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
