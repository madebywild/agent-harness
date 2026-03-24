import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "@iarna/toml";
import type { ProviderId } from "@madebywild/agent-harness-manifest";
import { DEFAULT_REGISTRY_ID, providerIdSchema } from "@madebywild/agent-harness-manifest";
import { fetchEntityFromRegistry } from "../entity-registries.js";
import {
  DEFAULT_PROMPT_SOURCE_PATH,
  defaultCommandOverridePath,
  defaultCommandSourcePath,
  defaultHookOverridePath,
  defaultHookSourcePath,
  defaultMcpOverridePath,
  defaultMcpSourcePath,
  defaultPromptOverridePath,
  defaultSettingsSourcePath,
  defaultSkillImportMetadataPath,
  defaultSkillOverridePath,
  defaultSkillSourcePath,
  defaultSubagentOverridePath,
  defaultSubagentSourcePath,
  resolveHarnessPaths,
} from "../paths.js";
import { listFilesRecursively, removeIfExists, writeLock, writeManifest } from "../repository.js";
import type {
  AgentsManifest,
  CliEntityType,
  EntityType,
  RegistryPullResult,
  RegistryRevision,
  RemoveResult,
} from "../types.js";
import { CLI_ENTITY_TO_MANIFEST_ENTITY, CLI_ENTITY_TYPES } from "../types.js";
import {
  ensureParentDir,
  exists,
  normalizeRelativePath,
  nowIso,
  parseJsonAsRecord,
  parseTomlAsRecord,
  sha256,
  stableStringify,
  withSingleTrailingNewline,
} from "../utils.js";
import {
  readLockOrDefault,
  readManifestOrThrow,
  removeLockEntityRecord,
  setLockEntityRecord,
  upsertLockEntityRecord,
  writeManagedSourceIndex,
} from "./state.js";
import {
  computeSkillSourceSha,
  isSkillOverrideFile,
  manifestEntityTypeToCliEntityType,
  registryIdFromInput,
  resolveEntityRegistrySelection,
  resolveRemoveTargetId,
  sortEntities,
  validateEntityId,
} from "./utils.js";

export async function ensureOverrideFiles(
  cwd: string,
  entityType: Exclude<EntityType, "settings">,
  entityId: string,
  existing?: Partial<Record<ProviderId, string>>,
): Promise<{
  overrides: Partial<Record<ProviderId, string>>;
  overrideShaByProvider: Partial<Record<ProviderId, string>>;
}> {
  const overrides: Partial<Record<ProviderId, string>> = {};
  const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};
  const defaultOverridePath: Record<Exclude<EntityType, "settings">, (id: string, p: ProviderId) => string> = {
    prompt: (_id, p) => defaultPromptOverridePath(p),
    skill: (id, p) => defaultSkillOverridePath(id, p),
    mcp_config: (id, p) => defaultMcpOverridePath(id, p),
    subagent: (id, p) => defaultSubagentOverridePath(id, p),
    hook: (id, p) => defaultHookOverridePath(id, p),
    command: (id, p) => defaultCommandOverridePath(id, p),
  };

  for (const provider of providerIdSchema.options) {
    const overridePath = existing?.[provider] ?? defaultOverridePath[entityType](entityId, provider);
    overrides[provider] = overridePath;

    const absolute = path.join(cwd, overridePath);
    if (!(await exists(absolute))) {
      await ensureParentDir(absolute);
      await fs.writeFile(absolute, "version: 1\n", "utf8");
    }

    const text = await fs.readFile(absolute, "utf8");
    overrideShaByProvider[provider] = sha256(text);
  }

  return { overrides, overrideShaByProvider };
}

export async function readCurrentSourceSha(cwd: string, entity: AgentsManifest["entities"][number]): Promise<string> {
  const sourceAbs = path.join(cwd, entity.sourcePath);
  if (entity.type === "prompt") {
    const text = await fs.readFile(sourceAbs, "utf8");
    return sha256(text);
  }

  if (entity.type === "subagent") {
    const text = await fs.readFile(sourceAbs, "utf8");
    return sha256(text);
  }

  if (entity.type === "mcp_config") {
    const text = await fs.readFile(sourceAbs, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`MCP source '${entity.sourcePath}' must be a JSON object`);
    }
    return sha256(stableStringify(parsed));
  }

  if (entity.type === "hook") {
    const text = await fs.readFile(sourceAbs, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Hook source '${entity.sourcePath}' must be a JSON object`);
    }
    return sha256(stableStringify(parsed));
  }

  if (entity.type === "settings") {
    const text = await fs.readFile(sourceAbs, "utf8");
    const provider = resolveSettingsProviderOrThrow(entity.id);
    const parsed = parseSettingsPayloadFromText(provider, text, entity.sourcePath);
    return sha256(stableStringify(parsed));
  }

  if (entity.type === "command") {
    const text = await fs.readFile(sourceAbs, "utf8");
    return sha256(text);
  }

  const skillRoot = path.join(cwd, `.harness/src/skills/${entity.id}`);
  const files = await loadSkillSourceHashes(skillRoot);
  return computeSkillSourceSha(files);
}

export async function loadSkillSourceHashes(skillRootAbs: string): Promise<Array<{ path: string; sha256: string }>> {
  const files = await listFilesRecursively(skillRootAbs);
  const output: Array<{ path: string; sha256: string }> = [];

  for (const filePath of files) {
    const relativePath = normalizeRelativePath(path.relative(skillRootAbs, filePath).replace(/\\/g, "/"));
    if (isSkillOverrideFile(relativePath)) {
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");
    output.push({ path: relativePath, sha256: sha256(content) });
  }

  output.sort((left, right) => left.path.localeCompare(right.path));
  return output;
}

function resolveSettingsProviderOrThrow(id: string): ProviderId {
  try {
    return providerIdSchema.parse(id);
  } catch {
    throw new Error(`Settings id must be one of: ${providerIdSchema.options.join(", ")}`);
  }
}

function parseSettingsPayloadFromText(provider: ProviderId, text: string, sourcePath: string): Record<string, unknown> {
  try {
    return provider === "codex" ? parseTomlAsRecord(text, TOML) : parseJsonAsRecord(text);
  } catch (error) {
    const format = provider === "codex" ? "TOML" : "JSON";
    throw new Error(
      `Settings source '${sourcePath}' is invalid ${format}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function serializeSettingsPayload(provider: ProviderId, payload: Record<string, unknown>): string {
  if (provider === "codex") {
    return withSingleTrailingNewline(TOML.stringify(payload as unknown as TOML.JsonMap));
  }

  return stableStringify(payload);
}

export async function materializeFetchedEntity(
  cwd: string,
  entity: AgentsManifest["entities"][number],
  fetched: Awaited<ReturnType<typeof fetchEntityFromRegistry>>,
): Promise<void> {
  if (entity.type === "prompt" && fetched.type === "prompt") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, fetched.sourceText, "utf8");
    return;
  }

  if (entity.type === "mcp_config" && fetched.type === "mcp_config") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, stableStringify(fetched.sourceJson), "utf8");
    return;
  }

  if (entity.type === "hook" && fetched.type === "hook") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, stableStringify(fetched.sourceJson), "utf8");
    return;
  }

  if (entity.type === "subagent" && fetched.type === "subagent") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, fetched.sourceText, "utf8");
    return;
  }

  if (entity.type === "settings" && fetched.type === "settings") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, serializeSettingsPayload(fetched.provider, fetched.sourcePayload), "utf8");
    return;
  }

  if (entity.type === "command" && fetched.type === "command") {
    const sourceAbs = path.join(cwd, entity.sourcePath);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, fetched.sourceText, "utf8");
    return;
  }

  if (entity.type === "skill" && fetched.type === "skill") {
    const skillRootAbs = path.join(cwd, `.harness/src/skills/${entity.id}`);
    await fs.mkdir(skillRootAbs, { recursive: true });

    const existingFiles = await listFilesRecursively(skillRootAbs);
    const incomingSet = new Set(fetched.files.map((file) => file.path));

    for (const existingFile of existingFiles) {
      const relativePath = normalizeRelativePath(path.relative(skillRootAbs, existingFile).replace(/\\/g, "/"));
      if (isSkillOverrideFile(relativePath)) {
        continue;
      }
      if (!incomingSet.has(relativePath)) {
        await fs.rm(existingFile, { force: true });
      }
    }

    for (const file of fetched.files) {
      const absolute = path.join(skillRootAbs, file.path);
      await ensureParentDir(absolute);
      await fs.writeFile(absolute, file.content, "utf8");
    }
    return;
  }

  throw new Error(`Fetched entity type mismatch for ${entity.type}:${entity.id}`);
}

export async function addPromptEntity(
  cwd: string,
  options?: { registry?: string; sourceText?: string },
): Promise<void> {
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  const existingPrompt = manifest.entities.find((entity) => entity.type === "prompt");
  if (existingPrompt) {
    throw new Error("Prompt entity already exists (v1 supports exactly one prompt)");
  }

  const sourcePath = DEFAULT_PROMPT_SOURCE_PATH;
  const sourceAbs = path.join(cwd, sourcePath);

  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add prompt because '${sourcePath}' already exists`);
  }

  let sourceText: string;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourceText) {
    sourceText = options.sourceText;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "prompt", "system");
      if (fetched.type !== "prompt") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected prompt from registry '${registry.id}'`);
      }
      sourceText = fetched.sourceText;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      sourceText = "# System Prompt\n\nDescribe the core behavior for the assistant.\n";
    }
  }

  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceText, "utf8");

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "prompt", "system");

  manifest.entities.push({
    id: "system",
    type: "prompt",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: "system",
    type: "prompt",
    registry: registryId,
    sourceSha256: sha256(sourceText),
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function addSkillEntity(
  cwd: string,
  skillId: string,
  options?: { registry?: string; files?: Array<{ path: string; content: string }> },
): Promise<void> {
  validateEntityId(skillId, "skill");
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "skill" && entity.id === skillId)) {
    throw new Error(`Skill '${skillId}' already exists`);
  }

  const sourcePath = defaultSkillSourcePath(skillId);
  const skillRootRel = `.harness/src/skills/${skillId}`;
  const skillRootAbs = path.join(cwd, skillRootRel);
  if (await exists(skillRootAbs)) {
    throw new Error(`Cannot add skill because '${skillRootRel}' already exists`);
  }

  let sourceSha256: string;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;
  let skillFiles: Array<{ path: string; content: string; sha256: string }>;

  if (options?.files) {
    skillFiles = options.files.map((file) => ({
      path: normalizeRelativePath(file.path),
      content: file.content,
      sha256: sha256(file.content),
    }));
    sourceSha256 = computeSkillSourceSha(skillFiles.map((file) => ({ path: file.path, sha256: file.sha256 })));
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "skill", skillId);
      if (fetched.type !== "skill") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected skill '${skillId}' from registry '${registry.id}'`);
      }
      skillFiles = fetched.files.map((file) => ({
        path: file.path,
        content: file.content,
        sha256: file.sha256,
      }));
      sourceSha256 = fetched.importedSourceSha256;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      const content = `---\nname: ${skillId}\ndescription: Describe what this skill does.\n---\n\n# ${skillId}\n\nAdd usage guidance here.\n`;
      skillFiles = [
        {
          path: "SKILL.md",
          content,
          sha256: sha256(content),
        },
      ];
      sourceSha256 = computeSkillSourceSha(skillFiles.map((file) => ({ path: file.path, sha256: file.sha256 })));
    }
  }

  for (const file of skillFiles) {
    const absolute = path.join(skillRootAbs, file.path);
    await ensureParentDir(absolute);
    await fs.writeFile(absolute, file.content, "utf8");
  }

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "skill", skillId);

  manifest.entities.push({
    id: skillId,
    type: "skill",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: skillId,
    type: "skill",
    registry: registryId,
    sourceSha256,
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function addMcpEntity(
  cwd: string,
  configId: string,
  options?: { registry?: string; sourceJson?: Record<string, unknown> },
): Promise<void> {
  validateEntityId(configId, "mcp_config");
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "mcp_config" && entity.id === configId)) {
    throw new Error(`MCP config '${configId}' already exists`);
  }

  const sourcePath = defaultMcpSourcePath(configId);
  const sourceAbs = path.join(cwd, sourcePath);
  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add MCP config because '${sourcePath}' already exists`);
  }

  let sourceJson: Record<string, unknown>;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourceJson) {
    sourceJson = options.sourceJson;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "mcp_config", configId);
      if (fetched.type !== "mcp_config") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected mcp config '${configId}' from registry '${registry.id}'`);
      }
      sourceJson = fetched.sourceJson;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      sourceJson = {
        servers: {
          [configId]: {
            command: "echo",
            args: ["configure-this-mcp-server"],
          },
        },
      };
    }
  }

  const sourceContent = stableStringify(sourceJson);
  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceContent, "utf8");

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "mcp_config", configId);

  manifest.entities.push({
    id: configId,
    type: "mcp_config",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: configId,
    type: "mcp_config",
    registry: registryId,
    sourceSha256: sha256(stableStringify(sourceJson)),
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function addSubagentEntity(
  cwd: string,
  subagentId: string,
  options?: { registry?: string; sourceText?: string },
): Promise<void> {
  validateEntityId(subagentId, "subagent");
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "subagent" && entity.id === subagentId)) {
    throw new Error(`Subagent '${subagentId}' already exists`);
  }

  const sourcePath = defaultSubagentSourcePath(subagentId);
  const sourceAbs = path.join(cwd, sourcePath);
  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add subagent because '${sourcePath}' already exists`);
  }

  let sourceText: string;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourceText) {
    sourceText = options.sourceText;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "subagent", subagentId);
      if (fetched.type !== "subagent") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected subagent '${subagentId}' from registry '${registry.id}'`);
      }
      sourceText = fetched.sourceText;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      sourceText =
        `---\nname: ${subagentId}\ndescription: Describe what this subagent does.\n---\n\n` +
        `You are the ${subagentId} subagent.\n\nAdd instructions here.\n`;
    }
  }

  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceText, "utf8");

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "subagent", subagentId);

  manifest.entities.push({
    id: subagentId,
    type: "subagent",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: subagentId,
    type: "subagent",
    registry: registryId,
    sourceSha256: sha256(sourceText),
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function addHookEntity(
  cwd: string,
  hookId: string,
  options?: { registry?: string; sourceJson?: Record<string, unknown> },
): Promise<void> {
  validateEntityId(hookId, "hook");
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "hook" && entity.id === hookId)) {
    throw new Error(`Hook '${hookId}' already exists`);
  }

  const sourcePath = defaultHookSourcePath(hookId);
  const sourceAbs = path.join(cwd, sourcePath);
  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add hook because '${sourcePath}' already exists`);
  }

  let sourceJson: Record<string, unknown>;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourceJson) {
    sourceJson = options.sourceJson;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "hook", hookId);
      if (fetched.type !== "hook") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected hook '${hookId}' from registry '${registry.id}'`);
      }
      sourceJson = fetched.sourceJson;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      sourceJson = {
        mode: "best_effort",
        events: {
          pre_tool_use: [
            {
              type: "command",
              command: "echo 'replace-with-hook-command'",
            },
          ],
        },
      };
    }
  }

  const sourceContent = stableStringify(sourceJson);
  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceContent, "utf8");

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "hook", hookId);

  manifest.entities.push({
    id: hookId,
    type: "hook",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: hookId,
    type: "hook",
    registry: registryId,
    sourceSha256: sha256(stableStringify(sourceJson)),
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function addSettingsEntity(
  cwd: string,
  provider: ProviderId,
  options?: { registry?: string; sourcePayload?: Record<string, unknown> },
): Promise<void> {
  const settingsProvider = providerIdSchema.parse(provider);
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "settings" && entity.id === settingsProvider)) {
    throw new Error(`Settings '${settingsProvider}' already exists`);
  }

  const sourcePath = defaultSettingsSourcePath(settingsProvider);
  const sourceAbs = path.join(cwd, sourcePath);
  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add settings because '${sourcePath}' already exists`);
  }

  let sourcePayload: Record<string, unknown>;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourcePayload) {
    sourcePayload = options.sourcePayload;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;
    sourcePayload = {};

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "settings", settingsProvider);
      if (fetched.type !== "settings") {
        throw new Error(
          `REGISTRY_FETCH_FAILED: expected settings '${settingsProvider}' from registry '${registry.id}'`,
        );
      }
      sourcePayload = fetched.sourcePayload;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    }
  }

  const sourceContent = serializeSettingsPayload(settingsProvider, sourcePayload);
  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceContent, "utf8");

  manifest.entities.push({
    id: settingsProvider,
    type: "settings",
    registry: registryId,
    sourcePath,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: settingsProvider,
    type: "settings",
    registry: registryId,
    sourceSha256: sha256(sourceContent),
    overrideSha256ByProvider: {},
    importedSourceSha256,
    registryRevision,
  });
}

export async function addCommandEntity(
  cwd: string,
  commandId: string,
  options?: { registry?: string; sourceText?: string },
): Promise<void> {
  validateEntityId(commandId, "command");
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if (manifest.entities.some((entity) => entity.type === "command" && entity.id === commandId)) {
    throw new Error(`Command '${commandId}' already exists`);
  }

  const sourcePath = defaultCommandSourcePath(commandId);
  const sourceAbs = path.join(cwd, sourcePath);
  if (await exists(sourceAbs)) {
    throw new Error(`Cannot add command because '${sourcePath}' already exists`);
  }

  let sourceText: string;
  let registryId: string;
  let importedSourceSha256: string | undefined;
  let registryRevision: RegistryRevision | undefined;

  if (options?.sourceText) {
    sourceText = options.sourceText;
    registryId = DEFAULT_REGISTRY_ID;
  } else {
    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    registryId = registry.id;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "command", commandId);
      if (fetched.type !== "command") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected command '${commandId}' from registry '${registry.id}'`);
      }
      sourceText = fetched.sourceText;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    } else {
      sourceText = `---\ndescription: "Describe what this command does"\n---\n\n# ${commandId}\n\nDescribe the task here. Use $ARGUMENTS to reference arguments passed to this command.\n`;
    }
  }

  await ensureParentDir(sourceAbs);
  await fs.writeFile(sourceAbs, sourceText, "utf8");

  const { overrides, overrideShaByProvider } = await ensureOverrideFiles(cwd, "command", commandId);

  manifest.entities.push({
    id: commandId,
    type: "command",
    registry: registryId,
    sourcePath,
    overrides,
    enabled: true,
  });
  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await upsertLockEntityRecord(paths, manifest, {
    id: commandId,
    type: "command",
    registry: registryId,
    sourceSha256: sha256(sourceText),
    overrideSha256ByProvider: overrideShaByProvider,
    importedSourceSha256,
    registryRevision,
  });
}

export async function pullRegistryEntities(
  cwd: string,
  options?: {
    entityType?: CliEntityType;
    id?: string;
    registry?: string;
    force?: boolean;
  },
): Promise<RegistryPullResult> {
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  if ((options?.entityType && !options.id) || (!options?.entityType && options?.id)) {
    throw new Error("registry pull requires both <entity-type> and <id> when targeting a specific entity");
  }

  if (options?.entityType && !CLI_ENTITY_TYPES.includes(options.entityType)) {
    throw new Error(`entity-type must be one of: ${CLI_ENTITY_TYPES.join(", ")}`);
  }

  const targetRegistryId = options?.registry ? registryIdFromInput(options.registry) : undefined;

  if (targetRegistryId && !manifest.registries.entries[targetRegistryId]) {
    throw new Error(`REGISTRY_NOT_FOUND: registry '${targetRegistryId}' is not configured`);
  }

  let targets = manifest.entities.filter((entity) => entity.registry !== DEFAULT_REGISTRY_ID);

  if (targetRegistryId) {
    targets = targets.filter((entity) => entity.registry === targetRegistryId);
  }

  if (options?.entityType && options.id) {
    const targetType = CLI_ENTITY_TO_MANIFEST_ENTITY[options.entityType];
    const targetId = resolveRemoveTargetId(options.entityType, options.id);
    targets = targets.filter((entity) => entity.type === targetType && entity.id === targetId);
  }

  if (targets.length === 0) {
    return { updatedEntities: [] };
  }

  const lock = await readLockOrDefault(paths, manifest);
  const plannedUpdates: Array<{
    entity: AgentsManifest["entities"][number];
    fetched: Awaited<ReturnType<typeof fetchEntityFromRegistry>>;
  }> = [];

  for (const entity of sortEntities(targets)) {
    const registryDef = manifest.registries.entries[entity.registry];
    if (!registryDef || registryDef.type !== "git") {
      continue;
    }

    const fetched = await fetchEntityFromRegistry(entity.registry, registryDef, entity.type, entity.id);
    const currentSourceSha = await readCurrentSourceSha(cwd, entity);
    const existingLockRecord = lock.entities.find((record) => record.type === entity.type && record.id === entity.id);

    if (
      existingLockRecord?.importedSourceSha256 &&
      currentSourceSha !== existingLockRecord.importedSourceSha256 &&
      options?.force !== true
    ) {
      throw new Error(
        `REGISTRY_PULL_CONFLICT: ${entity.type} '${entity.id}' has local changes. Re-run with --force to overwrite.`,
      );
    }

    plannedUpdates.push({ entity, fetched });
  }

  if (plannedUpdates.length === 0) {
    return { updatedEntities: [] };
  }

  const updatedEntities: RegistryPullResult["updatedEntities"] = [];
  let manifestMutated = false;

  for (const planned of plannedUpdates) {
    const { entity, fetched } = planned;
    await materializeFetchedEntity(cwd, entity, fetched);

    let overrideShaByProvider: Partial<Record<ProviderId, string>> = {};
    if (entity.type !== "settings") {
      const ensuredOverrides = await ensureOverrideFiles(cwd, entity.type, entity.id, entity.overrides);
      entity.overrides = ensuredOverrides.overrides;
      overrideShaByProvider = ensuredOverrides.overrideShaByProvider;
      manifestMutated = true;
    }

    const sourceSha256ForLock =
      entity.type === "settings" && fetched.type === "settings"
        ? sha256(serializeSettingsPayload(fetched.provider, fetched.sourcePayload))
        : fetched.importedSourceSha256;

    setLockEntityRecord(lock, {
      id: entity.id,
      type: entity.type,
      registry: entity.registry,
      sourceSha256: sourceSha256ForLock,
      overrideSha256ByProvider: overrideShaByProvider,
      importedSourceSha256: fetched.importedSourceSha256,
      registryRevision: fetched.registryRevision,
    });

    updatedEntities.push({
      type: manifestEntityTypeToCliEntityType(entity.type),
      id: entity.id,
    });
  }

  if (manifestMutated) {
    manifest.entities = sortEntities(manifest.entities);
    await writeManifest(paths, manifest);
  }
  if (updatedEntities.length === 0) {
    return { updatedEntities };
  }
  await writeManagedSourceIndex(paths, manifest);
  lock.generatedAt = nowIso();
  lock.manifestFingerprint = sha256(JSON.stringify(manifest));
  await writeLock(paths, lock);

  return { updatedEntities };
}

export async function removeEntity(
  cwd: string,
  entityTypeArg: CliEntityType,
  id: string,
  deleteSource: boolean,
): Promise<RemoveResult> {
  const paths = resolveHarnessPaths(cwd);
  const manifest = await readManifestOrThrow(paths);

  const entityType: EntityType = CLI_ENTITY_TO_MANIFEST_ENTITY[entityTypeArg];
  const targetId = resolveRemoveTargetId(entityTypeArg, id);

  const entityIndex = manifest.entities.findIndex((entity) => entity.type === entityType && entity.id === targetId);

  if (entityIndex === -1) {
    throw new Error(`Could not find ${entityTypeArg} entity '${targetId}'`);
  }

  const [entity] = manifest.entities.splice(entityIndex, 1);
  if (!entity) {
    throw new Error(`Could not find ${entityTypeArg} entity '${targetId}'`);
  }

  if (deleteSource) {
    await removeIfExists(path.join(cwd, normalizeRelativePath(entity.sourcePath)));
    if (entity.overrides) {
      for (const provider of providerIdSchema.options) {
        const overridePath = entity.overrides[provider];
        if (overridePath) {
          await removeIfExists(path.join(cwd, normalizeRelativePath(overridePath)));
        }
      }
    }

    if (entity.type === "skill") {
      await removeIfExists(path.join(cwd, `.harness/src/skills/${entity.id}`));
      await removeIfExists(path.join(cwd, defaultSkillImportMetadataPath(entity.id)));
    }
  }

  manifest.entities = sortEntities(manifest.entities);

  await writeManifest(paths, manifest);
  await writeManagedSourceIndex(paths, manifest);
  await removeLockEntityRecord(paths, manifest, entity.type, entity.id);

  return {
    entityType: entityTypeArg,
    id: entity.id,
  };
}
