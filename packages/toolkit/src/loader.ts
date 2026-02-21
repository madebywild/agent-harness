import fs from "node:fs/promises";
import path from "node:path";
import type { AgentsManifest, EntityRef, ProviderId, ProviderOverride } from "@agent-harness/manifest-schema";
import { providerIdSchema } from "@agent-harness/manifest-schema";
import matter from "gray-matter";
import {
  DEFAULT_PROMPT_SOURCE_PATH,
  defaultMcpOverridePath,
  defaultPromptOverridePath,
  defaultSkillOverridePath,
} from "./paths.js";
import type { HarnessPaths } from "./paths.js";
import {
  collectManagedSourcePaths,
  collectSourceCandidates,
  listFilesRecursively,
  readProviderOverrideFile,
} from "./repository.js";
import type { Diagnostic, LoadResult, LoadedMcp, LoadedPrompt, LoadedSkill } from "./types.js";
import { normalizeRelativePath, sha256, stableStringify, toPosixRelative } from "./utils.js";

export async function loadCanonicalState(paths: HarnessPaths, manifest: AgentsManifest): Promise<LoadResult> {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...validateManifestSemantics(manifest));
  diagnostics.push(...buildProviderEnablementDiagnostics(manifest));

  const candidates = await collectSourceCandidates(paths);
  const registeredSourcePaths = new Set(collectManagedSourcePaths(manifest));

  for (const candidate of candidates) {
    if (!registeredSourcePaths.has(candidate)) {
      diagnostics.push({
        code: "SOURCE_UNREGISTERED",
        severity: "error",
        message: `Source file '${candidate}' was not created through the CLI and is not registered in manifest`,
        hint: "Use 'harness add ...' to create entities, or remove the unmanaged file.",
        path: candidate,
      });
    }
  }

  const promptEntities = manifest.entities.filter((entity) => entity.type === "prompt" && entity.enabled !== false);
  let prompt: LoadedPrompt | undefined;

  if (promptEntities.length === 1) {
    const promptEntity = promptEntities[0];
    if (promptEntity) {
      const loadedPrompt = await loadPrompt(paths, promptEntity);
      diagnostics.push(...loadedPrompt.diagnostics);
      prompt = loadedPrompt.prompt;
    }
  }

  const skillEntities = manifest.entities.filter((entity) => entity.type === "skill" && entity.enabled !== false);
  const skills: LoadedSkill[] = [];
  for (const skillEntity of skillEntities) {
    const loadedSkill = await loadSkill(paths, skillEntity);
    diagnostics.push(...loadedSkill.diagnostics);
    if (loadedSkill.skill) {
      skills.push(loadedSkill.skill);
    }
  }

  const mcpEntities = manifest.entities.filter((entity) => entity.type === "mcp_config" && entity.enabled !== false);
  const mcps: LoadedMcp[] = [];
  for (const mcpEntity of mcpEntities) {
    const loadedMcp = await loadMcp(paths, mcpEntity);
    diagnostics.push(...loadedMcp.diagnostics);
    if (loadedMcp.mcp) {
      mcps.push(loadedMcp.mcp);
    }
  }

  return {
    manifest,
    diagnostics,
    prompt,
    skills: skills.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
    mcps: mcps.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
  };
}

function buildProviderEnablementDiagnostics(manifest: AgentsManifest): Diagnostic[] {
  const hasEnabledEntities = manifest.entities.some((entity) => entity.enabled !== false);
  if (!hasEnabledEntities || manifest.providers.enabled.length > 0) {
    return [];
  }

  return [
    {
      code: "NO_PROVIDERS_ENABLED",
      severity: "warning",
      message: "No providers are enabled, so apply will not generate any artifacts.",
      path: ".harness/manifest.json",
      hint: "Run 'harness provider enable <codex|claude|copilot>' before running apply.",
    },
  ];
}

export function validateManifestSemantics(manifest: AgentsManifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const providerSet = new Set<string>();
  for (const provider of manifest.providers.enabled) {
    if (providerSet.has(provider)) {
      diagnostics.push({
        code: "PROVIDER_DUPLICATE",
        severity: "error",
        message: `Provider '${provider}' is listed multiple times in providers.enabled`,
        path: ".harness/manifest.json",
      });
    }
    providerSet.add(provider);
  }

  const entityIdSet = new Set<string>();
  let promptCount = 0;

  for (const entity of manifest.entities) {
    if (entityIdSet.has(entity.id)) {
      diagnostics.push({
        code: "ENTITY_ID_DUPLICATE",
        severity: "error",
        message: `Entity id '${entity.id}' appears multiple times in manifest`,
        path: ".harness/manifest.json",
        entityId: entity.id,
      });
    }
    entityIdSet.add(entity.id);

    const sourcePath = normalizeRelativePath(entity.sourcePath);
    if (entity.type === "prompt") {
      promptCount += 1;
      if (entity.id !== "system") {
        diagnostics.push({
          code: "PROMPT_ID_INVALID",
          severity: "error",
          message: `Prompt entity id must be 'system' in v1, found '${entity.id}'`,
          path: sourcePath,
          entityId: entity.id,
        });
      }

      if (sourcePath !== DEFAULT_PROMPT_SOURCE_PATH) {
        diagnostics.push({
          code: "PROMPT_SOURCE_INVALID",
          severity: "error",
          message: `Prompt sourcePath must be '${DEFAULT_PROMPT_SOURCE_PATH}' in v1`,
          path: sourcePath,
          entityId: entity.id,
        });
      }
    }

    if (entity.type === "skill") {
      const expectedPath = `.harness/src/skills/${entity.id}/SKILL.md`;
      if (sourcePath !== expectedPath) {
        diagnostics.push({
          code: "SKILL_SOURCE_INVALID",
          severity: "error",
          message: `Skill '${entity.id}' sourcePath must be '${expectedPath}'`,
          path: sourcePath,
          entityId: entity.id,
        });
      }
    }

    if (entity.type === "mcp_config") {
      const expectedPath = `.harness/src/mcp/${entity.id}.json`;
      if (sourcePath !== expectedPath) {
        diagnostics.push({
          code: "MCP_SOURCE_INVALID",
          severity: "error",
          message: `MCP config '${entity.id}' sourcePath must be '${expectedPath}'`,
          path: sourcePath,
          entityId: entity.id,
        });
      }
    }
  }

  if (promptCount > 1) {
    diagnostics.push({
      code: "PROMPT_COUNT_INVALID",
      severity: "error",
      message: "v1 supports exactly zero or one prompt entity",
      path: ".harness/manifest.json",
    });
  }

  return diagnostics;
}

async function loadPrompt(
  paths: HarnessPaths,
  entity: EntityRef,
): Promise<{ prompt?: LoadedPrompt; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = normalizeRelativePath(entity.sourcePath);
  const sourceAbs = path.join(paths.root, sourcePath);

  let text: string;
  try {
    text = await fs.readFile(sourceAbs, "utf8");
  } catch (error) {
    diagnostics.push({
      code: "PROMPT_SOURCE_MISSING",
      severity: "error",
      message: `Prompt source file '${sourcePath}' could not be read`,
      path: sourcePath,
      entityId: entity.id,
      hint: error instanceof Error ? error.message : undefined,
    });
    return { diagnostics };
  }

  const parsed = matter(text);
  const body = parsed.content.trim();
  if (!body) {
    diagnostics.push({
      code: "PROMPT_EMPTY",
      severity: "error",
      message: `Prompt '${entity.id}' cannot be empty`,
      path: sourcePath,
      entityId: entity.id,
    });
  }

  const overrideByProvider = new Map<ProviderId, ProviderOverride | undefined>();
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerIdSchema.options) {
    const parsedOverride = await parseOverride(
      paths,
      provider,
      entity,
      entity.overrides?.[provider] ?? defaultPromptOverridePath(provider),
    );
    diagnostics.push(...parsedOverride.diagnostics);
    overrideByProvider.set(provider, parsedOverride.override);
    if (parsedOverride.sha256) {
      overrideShaByProvider[provider] = parsedOverride.sha256;
    }
  }

  return {
    diagnostics,
    prompt: {
      entity,
      canonical: {
        id: entity.id,
        body,
        frontmatter: (parsed.data as Record<string, unknown>) ?? {},
      },
      sourceSha256: sha256(text),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

async function loadSkill(
  paths: HarnessPaths,
  entity: EntityRef,
): Promise<{ skill?: LoadedSkill; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = normalizeRelativePath(entity.sourcePath);
  const sourceAbs = path.join(paths.root, sourcePath);
  const sourceDir = path.dirname(sourceAbs);

  const sourceExists = await fs
    .stat(sourceAbs)
    .then((stat) => stat.isFile())
    .catch(() => false);

  if (!sourceExists) {
    diagnostics.push({
      code: "SKILL_SOURCE_MISSING",
      severity: "error",
      message: `Skill source '${sourcePath}' could not be read`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const filesInDir = await listFilesRecursively(sourceDir);
  const filesWithContent: LoadedSkill["filesWithContent"] = [];

  for (const absolutePath of filesInDir) {
    const relativeFromRoot = toPosixRelative(absolutePath, paths.root);

    if (/\.ya?ml$/u.test(relativeFromRoot) && /OVERRIDES\.[a-z]+\.yaml$/u.test(path.basename(relativeFromRoot))) {
      continue;
    }

    const relativeInSkill = normalizeRelativePath(path.relative(sourceDir, absolutePath).replace(/\\/g, "/"));
    const content = await fs.readFile(absolutePath, "utf8");

    filesWithContent.push({
      path: relativeInSkill,
      sha256: sha256(content),
      content,
    });
  }

  const hasSkillMd = filesWithContent.some((file) => file.path === "SKILL.md");
  if (!hasSkillMd) {
    diagnostics.push({
      code: "SKILL_MARKDOWN_MISSING",
      severity: "error",
      message: `Skill '${entity.id}' must contain SKILL.md`,
      path: sourcePath,
      entityId: entity.id,
    });
  }

  const overrideByProvider = new Map<ProviderId, ProviderOverride | undefined>();
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerIdSchema.options) {
    const parsedOverride = await parseOverride(
      paths,
      provider,
      entity,
      entity.overrides?.[provider] ?? defaultSkillOverridePath(entity.id, provider),
    );
    diagnostics.push(...parsedOverride.diagnostics);
    overrideByProvider.set(provider, parsedOverride.override);
    if (parsedOverride.sha256) {
      overrideShaByProvider[provider] = parsedOverride.sha256;
    }
  }

  const normalizedFiles = filesWithContent
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    diagnostics,
    skill: {
      entity,
      canonical: {
        id: entity.id,
        files: normalizedFiles,
      },
      filesWithContent: filesWithContent.sort((left, right) => left.path.localeCompare(right.path)),
      sourceSha256: sha256(stableStringify(normalizedFiles)),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

async function loadMcp(
  paths: HarnessPaths,
  entity: EntityRef,
): Promise<{ mcp?: LoadedMcp; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = normalizeRelativePath(entity.sourcePath);
  const sourceAbs = path.join(paths.root, sourcePath);

  let text: string;
  try {
    text = await fs.readFile(sourceAbs, "utf8");
  } catch {
    diagnostics.push({
      code: "MCP_SOURCE_MISSING",
      severity: "error",
      message: `MCP source '${sourcePath}' could not be read`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  let json: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MCP config must be a JSON object");
    }
    json = parsed as Record<string, unknown>;
  } catch (error) {
    diagnostics.push({
      code: "MCP_JSON_INVALID",
      severity: "error",
      message: `MCP config '${entity.id}' is not valid JSON object: ${error instanceof Error ? error.message : "unknown error"}`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const overrideByProvider = new Map<ProviderId, ProviderOverride | undefined>();
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerIdSchema.options) {
    const parsedOverride = await parseOverride(
      paths,
      provider,
      entity,
      entity.overrides?.[provider] ?? defaultMcpOverridePath(entity.id, provider),
    );
    diagnostics.push(...parsedOverride.diagnostics);
    overrideByProvider.set(provider, parsedOverride.override);
    if (parsedOverride.sha256) {
      overrideShaByProvider[provider] = parsedOverride.sha256;
    }
  }

  return {
    diagnostics,
    mcp: {
      entity,
      canonical: {
        id: entity.id,
        json,
      },
      sourceSha256: sha256(stableStringify(json)),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

async function parseOverride(paths: HarnessPaths, provider: ProviderId, entity: EntityRef, pathValue: string) {
  return readProviderOverrideFile(paths.root, provider, pathValue).then((result) => ({
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      entityId: diagnostic.entityId ?? entity.id,
    })),
  }));
}
