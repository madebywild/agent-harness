import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentsManifest,
  EntityRef,
  ProviderId,
  ProviderOverride,
  RegistryDefinition,
} from "@madebywild/agent-harness-manifest";
import { DEFAULT_REGISTRY_ID, providerIdSchema } from "@madebywild/agent-harness-manifest";
import matter from "gray-matter";
import { loadEnvVars, pushUnresolvedEnvDiagnostics, substituteEnvVars } from "./env.js";
import { canonicalHookHasErrors, parseCanonicalHookDocument, withHookId } from "./hooks.js";
import type { HarnessPaths } from "./paths.js";
import {
  DEFAULT_PROMPT_SOURCE_PATH,
  defaultHookOverridePath,
  defaultHookSourcePath,
  defaultMcpOverridePath,
  defaultPromptOverridePath,
  defaultSkillOverridePath,
  defaultSubagentOverridePath,
} from "./paths.js";
import {
  collectManagedSourcePaths,
  collectSourceCandidates,
  listFilesRecursively,
  readProviderOverrideFile,
} from "./repository.js";
import type {
  Diagnostic,
  LoadedHook,
  LoadedMcp,
  LoadedPrompt,
  LoadedSkill,
  LoadedSubagent,
  LoadResult,
} from "./types.js";
import { normalizeRelativePath, sha256, stableStringify, toPosixRelative } from "./utils.js";

export async function loadCanonicalState(paths: HarnessPaths, manifest: AgentsManifest): Promise<LoadResult> {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...validateManifestSemantics(manifest));
  diagnostics.push(...buildProviderEnablementDiagnostics(manifest));

  // Load env vars
  const envResult = await loadEnvVars(paths);
  diagnostics.push(...envResult.diagnostics);
  const envVars = envResult.vars;

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
      const loadedPrompt = await loadPrompt(paths, promptEntity, envVars);
      diagnostics.push(...loadedPrompt.diagnostics);
      prompt = loadedPrompt.prompt;
    }
  }

  const skillEntities = manifest.entities.filter((entity) => entity.type === "skill" && entity.enabled !== false);
  const skills: LoadedSkill[] = [];
  for (const skillEntity of skillEntities) {
    const loadedSkill = await loadSkill(paths, skillEntity, envVars);
    diagnostics.push(...loadedSkill.diagnostics);
    if (loadedSkill.skill) {
      skills.push(loadedSkill.skill);
    }
  }

  const mcpEntities = manifest.entities.filter((entity) => entity.type === "mcp_config" && entity.enabled !== false);
  const mcps: LoadedMcp[] = [];
  for (const mcpEntity of mcpEntities) {
    const loadedMcp = await loadMcp(paths, mcpEntity, envVars);
    diagnostics.push(...loadedMcp.diagnostics);
    if (loadedMcp.mcp) {
      mcps.push(loadedMcp.mcp);
    }
  }

  const subagentEntities = manifest.entities.filter((entity) => entity.type === "subagent" && entity.enabled !== false);
  const subagents: LoadedSubagent[] = [];
  for (const subagentEntity of subagentEntities) {
    const loadedSubagent = await loadSubagent(paths, subagentEntity, envVars);
    diagnostics.push(...loadedSubagent.diagnostics);
    if (loadedSubagent.subagent) {
      subagents.push(loadedSubagent.subagent);
    }
  }

  const hookEntities = manifest.entities.filter((entity) => entity.type === "hook" && entity.enabled !== false);
  const hooks: LoadedHook[] = [];
  for (const hookEntity of hookEntities) {
    const loadedHook = await loadHook(paths, hookEntity, envVars);
    diagnostics.push(...loadedHook.diagnostics);
    if (loadedHook.hook) {
      hooks.push(loadedHook.hook);
    }
  }

  return {
    manifest,
    diagnostics,
    prompt,
    skills: skills.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
    mcps: mcps.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
    subagents: subagents.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
    hooks: hooks.sort((left, right) => left.entity.id.localeCompare(right.entity.id)),
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
  const registryEntries = manifest.registries.entries;

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

  const localRegistry = registryEntries[DEFAULT_REGISTRY_ID];
  if (!localRegistry || localRegistry.type !== "local") {
    diagnostics.push({
      code: "REGISTRY_NOT_FOUND",
      severity: "error",
      message: "Manifest registries.entries must include built-in 'local' registry with type 'local'",
      path: ".harness/manifest.json",
    });
  }

  if (!registryEntries[manifest.registries.default]) {
    diagnostics.push({
      code: "REGISTRY_DEFAULT_INVALID",
      severity: "error",
      message: `Default registry '${manifest.registries.default}' is not defined in registries.entries`,
      path: ".harness/manifest.json",
    });
  }

  const registryIds = new Set(Object.keys(registryEntries));
  const gitRegistryEntries = Object.entries(registryEntries).filter(([, entry]) => entry.type === "git");
  for (const [registryId, definition] of gitRegistryEntries) {
    validateGitRegistryEntry(registryId, definition, diagnostics);
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

    if (!registryIds.has(entity.registry)) {
      diagnostics.push({
        code: "REGISTRY_NOT_FOUND",
        severity: "error",
        message: `Entity '${entity.id}' references unknown registry '${entity.registry}'`,
        path: ".harness/manifest.json",
        entityId: entity.id,
      });
    }

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

    if (entity.type === "subagent") {
      const expectedPath = `.harness/src/subagents/${entity.id}.md`;
      if (sourcePath !== expectedPath) {
        diagnostics.push({
          code: "SUBAGENT_SOURCE_INVALID",
          severity: "error",
          message: `Subagent '${entity.id}' sourcePath must be '${expectedPath}'`,
          path: sourcePath,
          entityId: entity.id,
        });
      }
    }

    if (entity.type === "hook") {
      const expectedPath = defaultHookSourcePath(entity.id);
      if (sourcePath !== expectedPath) {
        diagnostics.push({
          code: "HOOK_SOURCE_INVALID",
          severity: "error",
          message: `Hook '${entity.id}' sourcePath must be '${expectedPath}'`,
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

function validateGitRegistryEntry(registryId: string, definition: RegistryDefinition, diagnostics: Diagnostic[]): void {
  if (definition.type !== "git") {
    return;
  }

  if (definition.tokenEnvVar && !/^[A-Z_][A-Z0-9_]*$/u.test(definition.tokenEnvVar)) {
    diagnostics.push({
      code: "REGISTRY_INVALID",
      severity: "error",
      message: `Registry '${registryId}' tokenEnvVar must be a valid environment variable name`,
      path: ".harness/manifest.json",
    });
  }
}

async function loadPrompt(
  paths: HarnessPaths,
  entity: EntityRef,
  envVars: Map<string, string>,
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

  const { result: substitutedText, unresolvedKeys } = substituteEnvVars(text, envVars);
  pushUnresolvedEnvDiagnostics(unresolvedKeys, diagnostics, sourcePath, { entityId: entity.id });

  const parsed = matter(substitutedText);
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
      envVars,
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
  envVars: Map<string, string>,
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
    const { result: substitutedContent, unresolvedKeys } = substituteEnvVars(content, envVars);
    pushUnresolvedEnvDiagnostics(unresolvedKeys, diagnostics, sourcePath, { entityId: entity.id });

    filesWithContent.push({
      path: relativeInSkill,
      sha256: sha256(content),
      content: substitutedContent,
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
      envVars,
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
  envVars: Map<string, string>,
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

  const parsedJson = parseJsonWithEnvSubstitution(text, envVars, diagnostics, sourcePath, entity.id);
  if (parsedJson.error) {
    diagnostics.push({
      code: "MCP_JSON_INVALID",
      severity: "error",
      message: `MCP config '${entity.id}' is not valid JSON object: ${parsedJson.error instanceof Error ? parsedJson.error.message : "unknown error"}`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }
  const json = parsedJson.value;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    diagnostics.push({
      code: "MCP_JSON_INVALID",
      severity: "error",
      message: `MCP config '${entity.id}' is not valid JSON object: MCP config must be a JSON object`,
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
      envVars,
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
        json: json as Record<string, unknown>,
      },
      sourceSha256: sha256(text),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

async function loadSubagent(
  paths: HarnessPaths,
  entity: EntityRef,
  envVars: Map<string, string>,
): Promise<{ subagent?: LoadedSubagent; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = normalizeRelativePath(entity.sourcePath);
  const sourceAbs = path.join(paths.root, sourcePath);

  let text: string;
  try {
    text = await fs.readFile(sourceAbs, "utf8");
  } catch {
    diagnostics.push({
      code: "SUBAGENT_SOURCE_MISSING",
      severity: "error",
      message: `Subagent source '${sourcePath}' could not be read`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const { result: substitutedText, unresolvedKeys } = substituteEnvVars(text, envVars);
  pushUnresolvedEnvDiagnostics(unresolvedKeys, diagnostics, sourcePath, { entityId: entity.id });

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(substitutedText);
  } catch (error) {
    diagnostics.push({
      code: "SUBAGENT_FRONTMATTER_INVALID",
      severity: "error",
      message: `Subagent '${entity.id}' frontmatter is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    diagnostics.push({
      code: "SUBAGENT_FRONTMATTER_INVALID",
      severity: "error",
      message: `Subagent '${entity.id}' frontmatter must be a YAML object`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const frontmatter = parsed.data as Record<string, unknown>;
  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  const body = parsed.content.trim();

  if (!name) {
    diagnostics.push({
      code: "SUBAGENT_NAME_REQUIRED",
      severity: "error",
      message: `Subagent '${entity.id}' requires a non-empty frontmatter name`,
      path: sourcePath,
      entityId: entity.id,
    });
  }

  if (!description) {
    diagnostics.push({
      code: "SUBAGENT_DESCRIPTION_REQUIRED",
      severity: "error",
      message: `Subagent '${entity.id}' requires a non-empty frontmatter description`,
      path: sourcePath,
      entityId: entity.id,
    });
  }

  if (!body) {
    diagnostics.push({
      code: "SUBAGENT_EMPTY",
      severity: "error",
      message: `Subagent '${entity.id}' cannot be empty`,
      path: sourcePath,
      entityId: entity.id,
    });
  }

  const metadata = Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => key !== "name" && key !== "description"),
  ) as Record<string, unknown>;

  const overrideByProvider = new Map<ProviderId, ProviderOverride | undefined>();
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerIdSchema.options) {
    const overridePath = entity.overrides?.[provider] ?? defaultSubagentOverridePath(entity.id, provider);
    const parsedOverride = await parseOverride(paths, provider, entity, overridePath, envVars);
    diagnostics.push(...parsedOverride.diagnostics);
    diagnostics.push(...validateSubagentOverrideOptions(entity.id, provider, parsedOverride.override, overridePath));
    overrideByProvider.set(provider, parsedOverride.override);
    if (parsedOverride.sha256) {
      overrideShaByProvider[provider] = parsedOverride.sha256;
    }
  }

  return {
    diagnostics,
    subagent: {
      entity,
      canonical: {
        id: entity.id,
        name: name || entity.id,
        description,
        body,
        metadata,
      },
      sourceSha256: sha256(text),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

async function loadHook(
  paths: HarnessPaths,
  entity: EntityRef,
  envVars: Map<string, string>,
): Promise<{ hook?: LoadedHook; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = normalizeRelativePath(entity.sourcePath);
  const sourceAbs = path.join(paths.root, sourcePath);

  let text: string;
  try {
    text = await fs.readFile(sourceAbs, "utf8");
  } catch {
    diagnostics.push({
      code: "HOOK_SOURCE_MISSING",
      severity: "error",
      message: `Hook source '${sourcePath}' could not be read`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const parsedJson = parseJsonWithEnvSubstitution(text, envVars, diagnostics, sourcePath, entity.id);
  if (parsedJson.error) {
    diagnostics.push({
      code: "HOOK_JSON_INVALID",
      severity: "error",
      message: `Hook '${entity.id}' is not valid JSON: ${parsedJson.error instanceof Error ? parsedJson.error.message : "unknown error"}`,
      path: sourcePath,
      entityId: entity.id,
    });
    return { diagnostics };
  }

  const parsedHook = parseCanonicalHookDocument(parsedJson.value, sourcePath, entity.id);
  diagnostics.push(...parsedHook.diagnostics);
  if (!parsedHook.canonical || canonicalHookHasErrors(parsedHook.diagnostics)) {
    return { diagnostics };
  }

  const overrideByProvider = new Map<ProviderId, ProviderOverride | undefined>();
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

  for (const provider of providerIdSchema.options) {
    const overridePath = entity.overrides?.[provider] ?? defaultHookOverridePath(entity.id, provider);
    const parsedOverride = await parseOverride(paths, provider, entity, overridePath, envVars);
    diagnostics.push(...parsedOverride.diagnostics);
    overrideByProvider.set(provider, parsedOverride.override);
    if (parsedOverride.sha256) {
      overrideShaByProvider[provider] = parsedOverride.sha256;
    }
  }

  return {
    diagnostics,
    hook: {
      entity,
      canonical: withHookId(parsedHook.canonical, entity.id),
      sourceSha256: sha256(text),
      overrideByProvider,
      overrideShaByProvider,
    },
  };
}

const JSON_ENV_PLACEHOLDER_RE = /^\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/u;

function parseJsonWithEnvSubstitution(
  text: string,
  envVars: Map<string, string>,
  diagnostics: Diagnostic[],
  sourcePath: string,
  entityId: string,
): { value: unknown; error?: undefined } | { value?: undefined; error: unknown } {
  const { result: substitutedText, unresolvedKeys } = substituteEnvVars(text, envVars);
  pushUnresolvedEnvDiagnostics(unresolvedKeys, diagnostics, sourcePath, { entityId });

  try {
    return { value: JSON.parse(substitutedText) as unknown };
  } catch (error) {
    if (unresolvedKeys.length === 0) {
      return { error };
    }

    const reparsed = parseJsonWithQuotedBarePlaceholders(substitutedText, unresolvedKeys);
    if (reparsed !== undefined) {
      return { value: reparsed };
    }
    return { error };
  }
}

function parseJsonWithQuotedBarePlaceholders(text: string, unresolvedKeys: string[]): unknown | undefined {
  const unresolved = new Set(unresolvedKeys);
  let inString = false;
  let escaped = false;
  let i = 0;
  let transformed = "";
  let changed = false;

  while (i < text.length) {
    const char = text[i];
    if (char === undefined) {
      break;
    }

    if (inString) {
      transformed += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (char === '"') {
      inString = true;
      transformed += char;
      i++;
      continue;
    }

    if (char === "{" && text[i + 1] === "{") {
      const slice = text.slice(i);
      const match = slice.match(JSON_ENV_PLACEHOLDER_RE);
      if (match) {
        const key = match[1];
        const placeholder = match[0];
        if (key && unresolved.has(key)) {
          transformed += JSON.stringify(`{{${key}}}`);
          changed = true;
        } else {
          transformed += placeholder;
        }
        i += placeholder.length;
        continue;
      }
    }

    transformed += char;
    i++;
  }

  if (!changed) {
    return undefined;
  }

  try {
    return JSON.parse(transformed) as unknown;
  } catch {
    return undefined;
  }
}

async function parseOverride(
  paths: HarnessPaths,
  provider: ProviderId,
  entity: EntityRef,
  pathValue: string,
  envVars?: Map<string, string>,
) {
  return readProviderOverrideFile(paths.root, provider, pathValue, envVars).then((result) => ({
    ...result,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      entityId: diagnostic.entityId ?? entity.id,
    })),
  }));
}

function validateSubagentOverrideOptions(
  entityId: string,
  provider: ProviderId,
  override: ProviderOverride | undefined,
  overridePath: string,
): Diagnostic[] {
  const options = override?.options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return [];
  }

  const allowed = new Set<string>(
    provider === "codex"
      ? ["model", "tools"]
      : provider === "claude"
        ? ["model", "tools"]
        : ["model", "tools", "handoffs"],
  );

  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length === 0) {
    return [];
  }

  return [
    {
      code: "SUBAGENT_OPTIONS_UNKNOWN",
      severity: "warning",
      message: `Subagent '${entityId}' has unknown ${provider} override option(s): ${unknown.sort().join(", ")}`,
      path: normalizeRelativePath(overridePath),
      entityId,
      provider,
      hint: "Unknown keys are ignored.",
    },
  ];
}
