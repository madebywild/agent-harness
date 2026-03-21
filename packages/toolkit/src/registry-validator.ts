import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "@iarna/toml";
import { parseRegistryManifest } from "@madebywild/agent-harness-manifest";
import matter from "gray-matter";
import { readPresetPackageFromDir } from "./preset-packages.js";
import { listFilesRecursively } from "./repository.js";
import type { Diagnostic, RegistryValidationOptions, RegistryValidationResult } from "./types.js";
import {
  isNotFoundError,
  normalizeRelativePath,
  parseJsonAsRecord,
  parseTomlAsRecord,
  readTextIfExists,
  toPosixRelative,
} from "./utils.js";

const ENTITY_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;
const REGISTRY_MANIFEST_FILE = "harness-registry.json";

export async function validateRegistryRepo(options: RegistryValidationOptions = {}): Promise<RegistryValidationResult> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  let rootPath = ".";
  const diagnostics: Diagnostic[] = [];

  if (options.rootPath && options.rootPath !== ".") {
    try {
      rootPath = normalizeRelativePath(options.rootPath);
    } catch {
      diagnostics.push(error("REGISTRY_ROOT_INVALID", `Invalid registry root path '${options.rootPath}'`));
      return { valid: false, diagnostics };
    }
  }

  const rootAbs = rootPath === "." ? repoPath : path.join(repoPath, rootPath);
  const manifestPath = path.join(repoPath, REGISTRY_MANIFEST_FILE);
  const manifestText = await readTextIfExists(manifestPath);

  if (manifestText === null) {
    diagnostics.push(
      error(
        "REGISTRY_MANIFEST_MISSING",
        `Registry is missing required ${REGISTRY_MANIFEST_FILE}`,
        REGISTRY_MANIFEST_FILE,
      ),
    );
  } else {
    const parsedManifest = await readJsonObject(
      manifestPath,
      "REGISTRY_MANIFEST_INVALID",
      "Registry manifest is invalid",
      diagnostics,
      repoPath,
    );

    if (parsedManifest) {
      try {
        parseRegistryManifest(parsedManifest);
      } catch (err) {
        diagnostics.push(
          error(
            "REGISTRY_MANIFEST_INVALID",
            `Registry manifest is invalid: ${err instanceof Error ? err.message : "unknown error"}`,
            REGISTRY_MANIFEST_FILE,
          ),
        );
      }
    }
  }

  const promptsDir = path.join(rootAbs, "prompts");
  let promptEntries: Dirent[] | null = null;
  try {
    promptEntries = await fs.readdir(promptsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (promptEntries) {
    let hasSystemPrompt = false;
    for (const entry of promptEntries) {
      const entryPath = toPosixRelative(path.join(promptsDir, entry.name), repoPath);
      if (entry.name === "system.md" && entry.isFile()) {
        hasSystemPrompt = true;
        continue;
      }
      diagnostics.push(error("REGISTRY_PROMPT_INVALID", "Only prompts/system.md is allowed in prompts/", entryPath));
    }

    const systemPromptPath = path.join(promptsDir, "system.md");
    if (!hasSystemPrompt) {
      diagnostics.push(
        error(
          "REGISTRY_PROMPT_INVALID",
          "Missing required prompts/system.md",
          toPosixRelative(systemPromptPath, repoPath),
        ),
      );
    } else {
      const text = await readTextIfExists(systemPromptPath);
      if (text === null || text.trim().length === 0) {
        diagnostics.push(
          error(
            "REGISTRY_PROMPT_INVALID",
            "prompts/system.md must be non-empty",
            toPosixRelative(systemPromptPath, repoPath),
          ),
        );
      }
    }
  }

  const skillsDir = path.join(rootAbs, "skills");
  let skillEntries: Dirent[] | null = null;
  try {
    skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (skillEntries) {
    for (const entry of skillEntries) {
      const skillPath = path.join(skillsDir, entry.name);
      const skillPathRel = toPosixRelative(skillPath, repoPath);

      if (!entry.isDirectory()) {
        diagnostics.push(error("REGISTRY_SKILL_INVALID", "skills/ may only contain skill directories", skillPathRel));
        continue;
      }

      if (!isValidEntityId(entry.name)) {
        diagnostics.push(error("REGISTRY_SKILL_INVALID", `Invalid skill id '${entry.name}'`, skillPathRel));
      }

      const files = await listFilesRecursively(skillPath);
      if (files.length === 0) {
        diagnostics.push(error("REGISTRY_SKILL_INVALID", `Skill '${entry.name}' has no files`, skillPathRel));
        continue;
      }

      const hasSkillMd = files.some((file) => path.relative(skillPath, file).replace(/\\/g, "/") === "SKILL.md");
      if (!hasSkillMd) {
        diagnostics.push(
          error(
            "REGISTRY_SKILL_INVALID",
            `Skill '${entry.name}' must contain SKILL.md at the skill root`,
            toPosixRelative(path.join(skillPath, "SKILL.md"), repoPath),
          ),
        );
      }
    }
  }

  const mcpDir = path.join(rootAbs, "mcp");
  let mcpEntries: Dirent[] | null = null;
  try {
    mcpEntries = await fs.readdir(mcpDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (mcpEntries) {
    for (const entry of mcpEntries) {
      const mcpPath = path.join(mcpDir, entry.name);
      const mcpPathRel = toPosixRelative(mcpPath, repoPath);

      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        diagnostics.push(error("REGISTRY_MCP_INVALID", "mcp/ may only contain .json files", mcpPathRel));
        continue;
      }

      const id = entry.name.slice(0, -".json".length);
      if (!isValidEntityId(id)) {
        diagnostics.push(error("REGISTRY_MCP_INVALID", `Invalid MCP config id '${id}'`, mcpPathRel));
      }

      await readJsonObject(mcpPath, "REGISTRY_MCP_INVALID", `MCP config '${id}' is invalid`, diagnostics, repoPath);
    }
  }

  const subagentsDir = path.join(rootAbs, "subagents");
  let subagentEntries: Dirent[] | null = null;
  try {
    subagentEntries = await fs.readdir(subagentsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (subagentEntries) {
    for (const entry of subagentEntries) {
      const subagentPath = path.join(subagentsDir, entry.name);
      const subagentPathRel = toPosixRelative(subagentPath, repoPath);

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        diagnostics.push(error("REGISTRY_SUBAGENT_INVALID", "subagents/ may only contain .md files", subagentPathRel));
        continue;
      }

      const id = entry.name.slice(0, -".md".length);
      if (!isValidEntityId(id)) {
        diagnostics.push(error("REGISTRY_SUBAGENT_INVALID", `Invalid subagent id '${id}'`, subagentPathRel));
      }

      const text = await readTextIfExists(subagentPath);
      if (text === null || text.trim().length === 0) {
        diagnostics.push(error("REGISTRY_SUBAGENT_INVALID", `Subagent '${id}' must be non-empty`, subagentPathRel));
        continue;
      }

      if (!hasDelimitedFrontmatterBlock(text)) {
        diagnostics.push(
          error(
            "REGISTRY_SUBAGENT_INVALID",
            `Subagent '${id}' frontmatter must include a YAML block delimited by ---`,
            subagentPathRel,
          ),
        );
        continue;
      }

      try {
        const parsed = matter(text);
        const body = parsed.content.trim();
        const frontmatter = parsed.data;

        if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
          diagnostics.push(
            error("REGISTRY_SUBAGENT_INVALID", `Subagent '${id}' frontmatter must be a YAML object`, subagentPathRel),
          );
          continue;
        }

        const frontmatterMap = frontmatter as Record<string, unknown>;
        const name = typeof frontmatterMap.name === "string" ? frontmatterMap.name.trim() : "";
        const description = typeof frontmatterMap.description === "string" ? frontmatterMap.description.trim() : "";

        if (!name) {
          diagnostics.push(
            error(
              "REGISTRY_SUBAGENT_INVALID",
              `Subagent '${id}' frontmatter requires non-empty 'name'`,
              subagentPathRel,
            ),
          );
        }

        if (!description) {
          diagnostics.push(
            error(
              "REGISTRY_SUBAGENT_INVALID",
              `Subagent '${id}' frontmatter requires non-empty 'description'`,
              subagentPathRel,
            ),
          );
        }

        if (!body) {
          diagnostics.push(
            error("REGISTRY_SUBAGENT_INVALID", `Subagent '${id}' body must be non-empty`, subagentPathRel),
          );
        }
      } catch (err) {
        diagnostics.push(
          error(
            "REGISTRY_SUBAGENT_INVALID",
            `Subagent '${id}' frontmatter is invalid: ${err instanceof Error ? err.message : "unknown error"}`,
            subagentPathRel,
          ),
        );
      }
    }
  }

  const hooksDir = path.join(rootAbs, "hooks");
  let hookEntries: Dirent[] | null = null;
  try {
    hookEntries = await fs.readdir(hooksDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (hookEntries) {
    for (const entry of hookEntries) {
      const hookPath = path.join(hooksDir, entry.name);
      const hookPathRel = toPosixRelative(hookPath, repoPath);

      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        diagnostics.push(error("REGISTRY_HOOK_INVALID", "hooks/ may only contain .json files", hookPathRel));
        continue;
      }

      const id = entry.name.slice(0, -".json".length);
      if (!isValidEntityId(id)) {
        diagnostics.push(error("REGISTRY_HOOK_INVALID", `Invalid hook id '${id}'`, hookPathRel));
      }

      await readJsonObject(hookPath, "REGISTRY_HOOK_INVALID", `Hook '${id}' is invalid`, diagnostics, repoPath);
    }
  }

  const settingsDir = path.join(rootAbs, "settings");
  let settingsEntries: Dirent[] | null = null;
  try {
    settingsEntries = await fs.readdir(settingsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  const presetsDir = path.join(rootAbs, "presets");
  let presetEntries: Dirent[] | null = null;
  try {
    presetEntries = await fs.readdir(presetsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (presetEntries) {
    for (const entry of presetEntries) {
      const presetPath = path.join(presetsDir, entry.name);
      const presetPathRel = toPosixRelative(presetPath, repoPath);

      if (!entry.isDirectory()) {
        diagnostics.push(
          error("REGISTRY_PRESET_INVALID", "presets/ may only contain preset directories", presetPathRel),
        );
        continue;
      }

      if (!isValidEntityId(entry.name)) {
        diagnostics.push(error("REGISTRY_PRESET_INVALID", `Invalid preset id '${entry.name}'`, presetPathRel));
      }

      try {
        const loaded = await readPresetPackageFromDir(presetPath);
        if (loaded.definition.id !== entry.name) {
          diagnostics.push(
            error(
              "REGISTRY_PRESET_INVALID",
              `Preset directory '${entry.name}' must match preset id '${loaded.definition.id}'`,
              presetPathRel,
            ),
          );
        }
      } catch (errorValue) {
        diagnostics.push(
          error(
            "REGISTRY_PRESET_INVALID",
            `Preset '${entry.name}' is invalid: ${errorValue instanceof Error ? errorValue.message : "unknown error"}`,
            presetPathRel,
          ),
        );
      }
    }
  }

  if (settingsEntries) {
    for (const entry of settingsEntries) {
      const settingsPath = path.join(settingsDir, entry.name);
      const settingsPathRel = toPosixRelative(settingsPath, repoPath);

      if (!entry.isFile()) {
        diagnostics.push(error("REGISTRY_SETTINGS_INVALID", "settings/ may only contain files", settingsPathRel));
        continue;
      }

      if (entry.name === "codex.toml") {
        await readTomlObject(
          settingsPath,
          "REGISTRY_SETTINGS_INVALID",
          "Settings 'codex' is invalid",
          diagnostics,
          repoPath,
        );
        continue;
      }

      if (entry.name === "claude.json" || entry.name === "copilot.json") {
        const id = entry.name.replace(".json", "");
        await readJsonObject(
          settingsPath,
          "REGISTRY_SETTINGS_INVALID",
          `Settings '${id}' is invalid`,
          diagnostics,
          repoPath,
        );
        continue;
      }

      diagnostics.push(
        error(
          "REGISTRY_SETTINGS_INVALID",
          "settings/ may only contain codex.toml, claude.json, and copilot.json",
          settingsPathRel,
        ),
      );
    }
  }

  const commandsDir = path.join(rootAbs, "commands");
  let commandEntries: Dirent[] | null = null;
  try {
    commandEntries = await fs.readdir(commandsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  if (commandEntries) {
    // Empty commands/ is acceptable; some registries intentionally publish no command entities.
    for (const entry of commandEntries) {
      const commandPath = path.join(commandsDir, entry.name);
      const commandPathRel = toPosixRelative(commandPath, repoPath);

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        diagnostics.push(
          error("REGISTRY_COMMAND_INVALID_FILE_TYPE", "commands/ may only contain .md files", commandPathRel),
        );
        continue;
      }

      const id = entry.name.slice(0, -".md".length);
      if (!isValidEntityId(id)) {
        diagnostics.push(error("REGISTRY_COMMAND_INVALID_ID", `Invalid command id '${id}'`, commandPathRel));
      }

      const text = await readTextIfExists(commandPath);
      if (text === null || text.trim().length === 0) {
        diagnostics.push(error("REGISTRY_COMMAND_EMPTY", `Command '${id}' must be non-empty`, commandPathRel));
        continue;
      }

      const hasFrontmatterBlock = hasDelimitedFrontmatterBlock(text);
      if (!hasFrontmatterBlock) {
        diagnostics.push(
          error(
            "REGISTRY_COMMAND_INVALID_FRONTMATTER",
            `Command '${id}' frontmatter must include a YAML block delimited by ---`,
            commandPathRel,
          ),
        );
        continue;
      }

      try {
        const parsed = matter(text);
        const frontmatter = parsed.data;
        if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
          diagnostics.push(
            error(
              "REGISTRY_COMMAND_INVALID_FRONTMATTER",
              `Command '${id}' frontmatter must be a YAML object`,
              commandPathRel,
            ),
          );
          continue;
        }

        const frontmatterMap = frontmatter as Record<string, unknown>;
        const description = typeof frontmatterMap.description === "string" ? frontmatterMap.description.trim() : "";
        if (!description) {
          diagnostics.push(
            error(
              "REGISTRY_COMMAND_MISSING_DESCRIPTION",
              `Command '${id}' frontmatter requires non-empty 'description'`,
              commandPathRel,
            ),
          );
        }

        const body = parsed.content.trim();
        if (!body) {
          diagnostics.push(error("REGISTRY_COMMAND_EMPTY", `Command '${id}' body must be non-empty`, commandPathRel));
        }
      } catch (err) {
        diagnostics.push(
          error(
            "REGISTRY_COMMAND_INVALID_FRONTMATTER",
            `Command '${id}' frontmatter is invalid: ${err instanceof Error ? err.message : "unknown error"}`,
            commandPathRel,
          ),
        );
      }
    }
  }

  diagnostics.sort((left, right) => {
    const pathCompare = (left.path ?? "").localeCompare(right.path ?? "");
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return left.code.localeCompare(right.code);
  });

  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
  };
}

function error(code: string, message: string, pathValue?: string): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    path: pathValue,
  };
}

async function readJsonObject(
  absPath: string,
  code: string,
  messagePrefix: string,
  diagnostics: Diagnostic[],
  repoPath: string,
): Promise<Record<string, unknown> | undefined> {
  const text = await readTextIfExists(absPath);
  if (text === null) {
    diagnostics.push(error(code, `${messagePrefix}: file is missing`, toPosixRelative(absPath, repoPath)));
    return undefined;
  }

  try {
    return parseJsonAsRecord(text);
  } catch (err) {
    diagnostics.push(
      error(
        code,
        `${messagePrefix}: ${err instanceof Error ? err.message : "invalid JSON"}`,
        toPosixRelative(absPath, repoPath),
      ),
    );
    return undefined;
  }
}

function isValidEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

async function readTomlObject(
  absPath: string,
  code: string,
  messagePrefix: string,
  diagnostics: Diagnostic[],
  repoPath: string,
): Promise<Record<string, unknown> | undefined> {
  const text = await readTextIfExists(absPath);
  if (text === null) {
    diagnostics.push(error(code, `${messagePrefix}: file is missing`, toPosixRelative(absPath, repoPath)));
    return undefined;
  }

  try {
    return parseTomlAsRecord(text, TOML);
  } catch (err) {
    diagnostics.push(
      error(
        code,
        `${messagePrefix}: ${err instanceof Error ? err.message : "invalid TOML"}`,
        toPosixRelative(absPath, repoPath),
      ),
    );
    return undefined;
  }
}

function hasDelimitedFrontmatterBlock(text: string): boolean {
  if (!text.startsWith("---")) {
    return false;
  }
  // Ensure the opening delimiter is exactly `---` on its own line (not `----` or other prefixes).
  if (!/^---(?:\r?\n|$)/u.test(text)) {
    return false;
  }
  const closingDelimiterPattern = /\r?\n---(?:\r?\n|$)/u;
  return closingDelimiterPattern.test(text.slice(3));
}
