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

  await validateCategoryEntities(
    {
      baseDir: path.join(rootAbs, "prompt-sections"),
      repoPath,
      requiredFile: "SECTION.md",
      requireFrontmatter: true,
      codes: {
        invalid: "REGISTRY_PROMPT_SECTION_INVALID",
        duplicateId: "REGISTRY_PROMPT_SECTION_DUPLICATE_ID",
        invalidTags: "REGISTRY_PROMPT_SECTION_INVALID_TAGS",
      },
    },
    diagnostics,
  );

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

      if (entry.name === "claude.json" || entry.name === "copilot.json" || entry.name === "cursor.json") {
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
          "settings/ may only contain codex.toml, claude.json, copilot.json, and cursor.json",
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

interface CategoryValidationSpec {
  baseDir: string;
  repoPath: string;
  requiredFile: string;
  // When true, the required file must carry `name`/`description` frontmatter (prompt-sections).
  requireFrontmatter: boolean;
  codes: { invalid: string; duplicateId: string; invalidTags: string };
}

// Validates a root entity tree organized into dynamic category folders:
// `<baseDir>/<category>/<id>/<requiredFile>`. Ids must be globally unique across categories. Empty
// category folders (only a `.gitkeep`) are allowed. Shared by root skills and prompt-sections.
async function validateCategoryEntities(spec: CategoryValidationSpec, diagnostics: Diagnostic[]): Promise<void> {
  const { baseDir, repoPath, requiredFile, requireFrontmatter, codes } = spec;

  let categories: Dirent[];
  try {
    categories = await fs.readdir(baseDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
    return;
  }

  const idToPath = new Map<string, string>();
  for (const category of categories) {
    if (category.name === ".gitkeep") {
      continue;
    }
    const categoryAbs = path.join(baseDir, category.name);
    const categoryRel = toPosixRelative(categoryAbs, repoPath);
    if (!category.isDirectory()) {
      diagnostics.push(
        error(
          codes.invalid,
          `${toPosixRelative(baseDir, repoPath)} may only contain category directories`,
          categoryRel,
        ),
      );
      continue;
    }

    const idEntries = await fs.readdir(categoryAbs, { withFileTypes: true });
    for (const idEntry of idEntries) {
      if (idEntry.name === ".gitkeep") {
        continue;
      }
      const idAbs = path.join(categoryAbs, idEntry.name);
      const idRel = toPosixRelative(idAbs, repoPath);
      if (!idEntry.isDirectory()) {
        diagnostics.push(error(codes.invalid, `${categoryRel} may only contain entity directories`, idRel));
        continue;
      }
      if (!isValidEntityId(idEntry.name)) {
        diagnostics.push(error(codes.invalid, `Invalid id '${idEntry.name}'`, idRel));
      }

      const existing = idToPath.get(idEntry.name);
      if (existing) {
        diagnostics.push(
          error(codes.duplicateId, `Duplicate id '${idEntry.name}' found in '${existing}' and '${idRel}'`, idRel),
        );
      } else {
        idToPath.set(idEntry.name, idRel);
      }

      const requiredAbs = path.join(idAbs, requiredFile);
      const requiredRel = toPosixRelative(requiredAbs, repoPath);
      const text = await readTextIfExists(requiredAbs);
      if (text === null) {
        diagnostics.push(
          error(codes.invalid, `'${idEntry.name}' must contain ${requiredFile} at its root`, requiredRel),
        );
        continue;
      }
      if (text.trim().length === 0) {
        diagnostics.push(error(codes.invalid, `${requiredFile} must be non-empty`, requiredRel));
        continue;
      }

      const data = matter(text).data as Record<string, unknown>;
      if (requireFrontmatter) {
        if (typeof data.name !== "string" || data.name.trim().length === 0) {
          diagnostics.push(
            error(codes.invalid, `${requiredFile} frontmatter must include a non-empty 'name'`, requiredRel),
          );
        }
        if (typeof data.description !== "string" || data.description.trim().length === 0) {
          diagnostics.push(
            error(codes.invalid, `${requiredFile} frontmatter must include a non-empty 'description'`, requiredRel),
          );
        }
      }
      const tagsError = validateTagsField(data.tags);
      if (tagsError) {
        diagnostics.push(error(codes.invalidTags, `${requiredFile} ${tagsError}`, requiredRel));
      }
    }
  }
}

// Optional `tags` frontmatter must be an array of strings when present. Returns an error message or
// null. Shared by prompt-sections (this pass) and skills.
function validateTagsField(tags: unknown): string | null {
  if (tags === undefined) {
    return null;
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    return "frontmatter 'tags' must be an array of strings";
  }
  return null;
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
