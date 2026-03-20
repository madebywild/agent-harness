import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseRegistryManifest } from "@madebywild/agent-harness-manifest";
import matter from "gray-matter";
import { listFilesRecursively } from "./repository.js";
import type { Diagnostic, RegistryValidationOptions, RegistryValidationResult } from "./types.js";
import { isNotFoundError, normalizeRelativePath, readTextIfExists, toPosixRelative } from "./utils.js";

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
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      diagnostics.push(error(code, `${messagePrefix}: expected a JSON object`, toPosixRelative(absPath, repoPath)));
      return undefined;
    }
    return parsed as Record<string, unknown>;
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
