import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseRegistryManifest } from "@madebywild/agent-harness-manifest";
import matter from "gray-matter";
import { readPresetPackageFromDir } from "./preset-packages.js";
import type { Diagnostic, PresetDefinition, RegistryValidationOptions, RegistryValidationResult } from "./types.js";
import {
  isNotFoundError,
  normalizeRelativePath,
  parseJsonAsRecord,
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

  await validateCategoryEntities(
    {
      baseDir: path.join(rootAbs, "skills"),
      repoPath,
      requiredFile: "SKILL.md",
      // Skills are opaque bundles; only optional `tags` is validated (name/description are not required).
      requireFrontmatter: false,
      codes: {
        invalid: "REGISTRY_SKILL_INVALID",
        duplicateId: "REGISTRY_SKILL_DUPLICATE_ID",
        invalidTags: "REGISTRY_SKILL_INVALID_TAGS",
      },
    },
    diagnostics,
  );

  // Strict root: only skills/, prompt-sections/, and presets/ may hold entities at the registry
  // root. Every other entity kind lives inside a preset package.
  await validateNoForbiddenRootEntities(rootAbs, repoPath, diagnostics);

  const presetsDir = path.join(rootAbs, "presets");
  let presetEntries: Dirent[] | null = null;
  try {
    presetEntries = await fs.readdir(presetsDir, { withFileTypes: true });
  } catch (err) {
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  const presetDefsById = new Map<string, PresetDefinition>();
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
        presetDefsById.set(loaded.definition.id, loaded.definition);

        // Strict root: only add_skill / add_prompt_section may be registry-sourced; every other
        // entity kind is embedded in the preset package.
        for (const operation of loaded.definition.operations) {
          const source = "source" in operation ? operation.source?.registry : undefined;
          if (source && operation.type !== "add_skill" && operation.type !== "add_prompt_section") {
            diagnostics.push(
              error(
                "REGISTRY_PRESET_INVALID",
                `Preset '${loaded.definition.id}' operation '${operation.type}' cannot declare a registry source; only add_skill and add_prompt_section reference the registry (other entities are embedded)`,
                presetPathRel,
              ),
            );
          }
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

  validatePresetExtends(presetDefsById, presetsDir, repoPath, diagnostics);

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
// null. Shared by prompt-sections and skills.
function validateTagsField(tags: unknown): string | null {
  if (tags === undefined) {
    return null;
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    return "frontmatter 'tags' must be an array of strings";
  }
  return null;
}

// Strict root: entity kinds other than skills and prompt-sections live only inside preset packages,
// so their legacy root folders are no longer part of the registry contract.
const FORBIDDEN_ROOT_ENTITY_DIRS = ["prompts", "mcp", "subagents", "hooks", "settings", "commands"] as const;

async function validateNoForbiddenRootEntities(
  rootAbs: string,
  repoPath: string,
  diagnostics: Diagnostic[],
): Promise<void> {
  for (const name of FORBIDDEN_ROOT_ENTITY_DIRS) {
    const dir = path.join(rootAbs, name);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(dir);
    } catch (err) {
      if (isNotFoundError(err)) {
        continue;
      }
      throw err;
    }
    if (stat.isDirectory()) {
      diagnostics.push(
        error(
          "REGISTRY_ROOT_ENTITY_FORBIDDEN",
          `Root '${name}/' is not allowed; only skills, prompt-sections, and presets may live at the registry root. Move ${name} entities into a preset package.`,
          toPosixRelative(dir, repoPath),
        ),
      );
    }
  }
}

// A preset's `extends` target must exist in this registry and the extends graph must be acyclic.
function validatePresetExtends(
  defsById: Map<string, PresetDefinition>,
  presetsDir: string,
  repoPath: string,
  diagnostics: Diagnostic[],
): void {
  for (const [id, definition] of defsById) {
    const presetPathRel = toPosixRelative(path.join(presetsDir, id), repoPath);

    // Missing parent anywhere in the chain.
    let cursor: string | undefined = definition.extends;
    const localVisited = new Set<string>([id]);
    while (cursor) {
      if (!defsById.has(cursor)) {
        diagnostics.push(
          error(
            "REGISTRY_PRESET_EXTENDS_NOT_FOUND",
            `Preset '${id}' extends unknown preset '${cursor}'`,
            presetPathRel,
          ),
        );
        break;
      }
      if (localVisited.has(cursor)) {
        diagnostics.push(
          error(
            "REGISTRY_PRESET_EXTENDS_CYCLE",
            `Preset '${id}' has a cyclic extends chain via '${cursor}'`,
            presetPathRel,
          ),
        );
        break;
      }
      localVisited.add(cursor);
      cursor = defsById.get(cursor)?.extends;
    }
  }
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
