import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_REGISTRY_ID, providerIdSchema } from "@agent-harness/manifest-schema";
import type { ProviderId } from "@agent-harness/manifest-schema";
import {
  LATEST_VERSION_BY_KIND,
  agentsManifestSchema,
  managedIndexSchema,
  manifestLockSchema,
} from "@agent-harness/manifest-schema";
import chokidar from "chokidar";
import { fetchEntityFromRegistry } from "./entity-registries.js";
import { loadCanonicalState } from "./loader.js";
import {
  DEFAULT_PROMPT_SOURCE_PATH,
  defaultMcpOverridePath,
  defaultMcpSourcePath,
  defaultPromptOverridePath,
  defaultSkillOverridePath,
  defaultSkillSourcePath,
  resolveHarnessPaths,
} from "./paths.js";
import { buildPlan } from "./planner.js";
import {
  collectManagedSourcePaths,
  emptyManagedIndex,
  loadLock,
  loadManagedIndex,
  loadManifest,
  removeIfExists,
  writeLock,
  writeManagedIndex,
  writeManifest,
} from "./repository.js";
import type {
  AgentsManifest,
  ApplyResult,
  CliEntityType,
  Diagnostic,
  DoctorResult,
  EntityType,
  InternalPlanResult,
  LockEntityRecord,
  ManagedIndex,
  ManifestLock,
  MigrationResult,
  PlanResult,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  RegistryListEntry,
  RegistryPullResult,
  RegistryRevision,
  RemoveResult,
  ValidationResult,
} from "./types.js";
import { CLI_ENTITY_TO_MANIFEST_ENTITY, CLI_ENTITY_TYPES } from "./types.js";
import {
  ensureParentDir,
  exists,
  normalizeRelativePath,
  nowIso,
  readTextIfExists,
  sha256,
  stableStringify,
  uniqSorted,
} from "./utils.js";
import { buildVersionPreflightDiagnostics, hasVersionBlockers, runDoctor } from "./versioning/doctor.js";
import { runMigration } from "./versioning/migrate.js";

export class HarnessEngine {
  private readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  async init(options?: { force?: boolean }): Promise<void> {
    const paths = resolveHarnessPaths(this.cwd);
    const force = options?.force === true;

    if (await exists(paths.agentsDir)) {
      await this.assertWorkspaceVersionCurrent({ allowMissingManifest: true });
    }

    if (await exists(paths.agentsDir)) {
      if (!force) {
        throw new Error("Harness workspace already exists at '.harness'. Use 'harness init --force' to overwrite.");
      }
      await fs.rm(paths.agentsDir, { recursive: true, force: true });
    }

    await fs.mkdir(paths.promptDir, { recursive: true });
    await fs.mkdir(paths.skillDir, { recursive: true });
    await fs.mkdir(paths.mcpDir, { recursive: true });

    const manifest: AgentsManifest = {
      version: LATEST_VERSION_BY_KIND.manifest as AgentsManifest["version"],
      providers: {
        enabled: [],
      },
      registries: {
        default: DEFAULT_REGISTRY_ID,
        entries: {
          [DEFAULT_REGISTRY_ID]: { type: "local" },
        },
      },
      entities: [],
    };

    const lock: ManifestLock = {
      version: LATEST_VERSION_BY_KIND.lock as ManifestLock["version"],
      generatedAt: nowIso(),
      manifestFingerprint: sha256(JSON.stringify(manifest)),
      entities: [],
      outputs: [],
    };

    const managedIndex: ManagedIndex = emptyManagedIndex();

    await writeManifest(paths, manifest);
    await writeLock(paths, lock);
    await writeManagedIndex(paths, managedIndex);
  }

  async enableProvider(provider: ProviderId): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await this.readManifestOrThrow();
    if (!manifest.providers.enabled.includes(provider)) {
      manifest.providers.enabled = uniqSorted([...manifest.providers.enabled, provider]) as ProviderId[];
      await writeManifest(resolveHarnessPaths(this.cwd), manifest);
    }
  }

  async disableProvider(provider: ProviderId): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await this.readManifestOrThrow();
    manifest.providers.enabled = manifest.providers.enabled.filter((entry) => entry !== provider);
    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async listRegistries(): Promise<RegistryListEntry[]> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await this.readManifestOrThrow();
    return Object.entries(manifest.registries.entries)
      .map(([id, definition]) => ({
        id,
        definition,
        isDefault: id === manifest.registries.default,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async addRegistry(
    name: string,
    options: { gitUrl: string; ref?: string; rootPath?: string; tokenEnvVar?: string },
  ): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateRegistryId(name);
    const manifest = await this.readManifestOrThrow();

    if (manifest.registries.entries[name]) {
      throw new Error(`Registry '${name}' already exists`);
    }

    manifest.registries.entries[name] = {
      type: "git",
      url: options.gitUrl,
      ref: options.ref ?? "main",
      rootPath: options.rootPath ? normalizeRelativePath(options.rootPath) : undefined,
      tokenEnvVar: options.tokenEnvVar,
    };

    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async removeRegistry(name: string): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateRegistryId(name);
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

    if (name === DEFAULT_REGISTRY_ID) {
      throw new Error("REGISTRY_LOCAL_IMMUTABLE: built-in 'local' registry cannot be removed");
    }

    if (!manifest.registries.entries[name]) {
      throw new Error(`Registry '${name}' does not exist`);
    }

    if (manifest.registries.default === name) {
      throw new Error(`Cannot remove registry '${name}' while it is default. Set a new default first.`);
    }

    if (manifest.entities.some((entity) => entity.registry === name)) {
      throw new Error(`Cannot remove registry '${name}' because it is used by one or more entities`);
    }

    delete manifest.registries.entries[name];
    await writeManifest(paths, manifest);
  }

  async setDefaultRegistry(name: string): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateRegistryId(name);
    const manifest = await this.readManifestOrThrow();
    if (!manifest.registries.entries[name]) {
      throw new Error(`REGISTRY_NOT_FOUND: registry '${name}' is not configured`);
    }

    manifest.registries.default = name;
    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async getDefaultRegistry(): Promise<string> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await this.readManifestOrThrow();
    return manifest.registries.default;
  }

  async addPrompt(options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

    const existingPrompt = manifest.entities.find((entity) => entity.type === "prompt");
    if (existingPrompt) {
      throw new Error("Prompt entity already exists (v1 supports exactly one prompt)");
    }

    const sourcePath = DEFAULT_PROMPT_SOURCE_PATH;
    const sourceAbs = path.join(this.cwd, sourcePath);

    if (await exists(sourceAbs)) {
      throw new Error(`Cannot add prompt because '${sourcePath}' already exists`);
    }

    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    let sourceText = "# System Prompt\n\nDescribe the core behavior for the assistant.\n";
    let importedSourceSha256: string | undefined;
    let registryRevision: RegistryRevision | undefined;

    if (registry.definition.type === "git") {
      const fetched = await fetchEntityFromRegistry(registry.id, registry.definition, "prompt", "system");
      if (fetched.type !== "prompt") {
        throw new Error(`REGISTRY_FETCH_FAILED: expected prompt from registry '${registry.id}'`);
      }
      sourceText = fetched.sourceText;
      importedSourceSha256 = fetched.importedSourceSha256;
      registryRevision = fetched.registryRevision;
    }

    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, sourceText, "utf8");

    const { overrides, overrideShaByProvider } = await this.ensureOverrideFiles("prompt", "system");

    manifest.entities.push({
      id: "system",
      type: "prompt",
      registry: registry.id,
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);
    await this.writeManagedSourceIndex(paths, manifest);
    await this.upsertLockEntityRecord(paths, manifest, {
      id: "system",
      type: "prompt",
      registry: registry.id,
      sourceSha256: sha256(sourceText),
      overrideSha256ByProvider: overrideShaByProvider,
      importedSourceSha256,
      registryRevision,
    });
  }

  async addSkill(skillId: string, options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateEntityId(skillId, "skill");
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

    if (manifest.entities.some((entity) => entity.type === "skill" && entity.id === skillId)) {
      throw new Error(`Skill '${skillId}' already exists`);
    }

    const sourcePath = defaultSkillSourcePath(skillId);
    const skillRootRel = `.harness/src/skills/${skillId}`;
    const skillRootAbs = path.join(this.cwd, skillRootRel);
    if (await exists(skillRootAbs)) {
      throw new Error(`Cannot add skill because '${skillRootRel}' already exists`);
    }

    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    let sourceSha256: string;
    let importedSourceSha256: string | undefined;
    let registryRevision: RegistryRevision | undefined;
    let skillFiles: Array<{ path: string; content: string; sha256: string }>;

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

    for (const file of skillFiles) {
      const absolute = path.join(skillRootAbs, file.path);
      await ensureParentDir(absolute);
      await fs.writeFile(absolute, file.content, "utf8");
    }

    const { overrides, overrideShaByProvider } = await this.ensureOverrideFiles("skill", skillId);

    manifest.entities.push({
      id: skillId,
      type: "skill",
      registry: registry.id,
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);
    await this.writeManagedSourceIndex(paths, manifest);
    await this.upsertLockEntityRecord(paths, manifest, {
      id: skillId,
      type: "skill",
      registry: registry.id,
      sourceSha256,
      overrideSha256ByProvider: overrideShaByProvider,
      importedSourceSha256,
      registryRevision,
    });
  }

  async addMcp(configId: string, options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateEntityId(configId, "mcp_config");
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

    if (manifest.entities.some((entity) => entity.type === "mcp_config" && entity.id === configId)) {
      throw new Error(`MCP config '${configId}' already exists`);
    }

    const sourcePath = defaultMcpSourcePath(configId);
    const sourceAbs = path.join(this.cwd, sourcePath);
    if (await exists(sourceAbs)) {
      throw new Error(`Cannot add MCP config because '${sourcePath}' already exists`);
    }

    const registry = resolveEntityRegistrySelection(manifest, options?.registry);
    let sourceJson: Record<string, unknown>;
    let importedSourceSha256: string | undefined;
    let registryRevision: RegistryRevision | undefined;

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

    const sourceContent = stableStringify(sourceJson);
    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, sourceContent, "utf8");

    const { overrides, overrideShaByProvider } = await this.ensureOverrideFiles("mcp_config", configId);

    manifest.entities.push({
      id: configId,
      type: "mcp_config",
      registry: registry.id,
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);
    await this.writeManagedSourceIndex(paths, manifest);
    await this.upsertLockEntityRecord(paths, manifest, {
      id: configId,
      type: "mcp_config",
      registry: registry.id,
      sourceSha256: sha256(stableStringify(sourceJson)),
      overrideSha256ByProvider: overrideShaByProvider,
      importedSourceSha256,
      registryRevision,
    });
  }

  async pullRegistry(options?: {
    entityType?: CliEntityType;
    id?: string;
    registry?: string;
    force?: boolean;
  }): Promise<RegistryPullResult> {
    await this.assertWorkspaceVersionCurrent();
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

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

    const lock = await this.readLockOrDefault(manifest);
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
      const currentSourceSha = await this.readCurrentSourceSha(entity);
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
      await this.materializeFetchedEntity(entity, fetched);
      const ensuredOverrides = await this.ensureOverrideFiles(entity.type, entity.id, entity.overrides);
      entity.overrides = ensuredOverrides.overrides;
      manifestMutated = true;

      this.setLockEntityRecord(lock, {
        id: entity.id,
        type: entity.type,
        registry: entity.registry,
        sourceSha256: fetched.importedSourceSha256,
        overrideSha256ByProvider: ensuredOverrides.overrideShaByProvider,
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
    await this.writeManagedSourceIndex(paths, manifest);
    lock.generatedAt = nowIso();
    lock.manifestFingerprint = sha256(JSON.stringify(manifest));
    await writeLock(paths, lock);

    return { updatedEntities };
  }

  async remove(entityTypeArg: CliEntityType, id: string, deleteSource: boolean): Promise<RemoveResult> {
    await this.assertWorkspaceVersionCurrent();
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

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
      await removeIfExists(path.join(this.cwd, normalizeRelativePath(entity.sourcePath)));
      if (entity.overrides) {
        for (const provider of providerIdSchema.options) {
          const overridePath = entity.overrides[provider];
          if (overridePath) {
            await removeIfExists(path.join(this.cwd, normalizeRelativePath(overridePath)));
          }
        }
      }

      if (entity.type === "skill") {
        await removeIfExists(path.join(this.cwd, `.harness/src/skills/${entity.id}`));
      }
    }

    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);
    await this.writeManagedSourceIndex(paths, manifest);
    await this.removeLockEntityRecord(paths, manifest, entity.type, entity.id);

    return {
      entityType: entityTypeArg,
      id: entity.id,
    };
  }

  async validate(): Promise<ValidationResult> {
    const result = await this.planInternal();
    return {
      valid: !result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      diagnostics: result.diagnostics,
    };
  }

  async plan(): Promise<PlanResult> {
    const result = await this.planInternal();
    return {
      operations: result.operations,
      diagnostics: result.diagnostics,
      nextLock: result.nextLock,
    };
  }

  async apply(): Promise<ApplyResult> {
    const planResult = await this.planInternal();
    const diagnostics = planResult.diagnostics;

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return {
        ...planResult,
        writtenArtifacts: [],
        prunedArtifacts: [],
      };
    }

    const paths = resolveHarnessPaths(this.cwd);
    const writtenArtifacts: string[] = [];
    const prunedArtifacts: string[] = [];

    for (const operation of planResult.operations) {
      const absolutePath = path.join(this.cwd, operation.path);

      if (operation.type === "create" || operation.type === "update") {
        const artifact = planResult.artifactsByPath.get(operation.path);
        if (!artifact) {
          continue;
        }

        await ensureParentDir(absolutePath);
        await fs.writeFile(absolutePath, artifact.content, "utf8");
        writtenArtifacts.push(operation.path);
      }

      if (operation.type === "delete") {
        await removeIfExists(absolutePath);
        prunedArtifacts.push(operation.path);
      }
    }

    const currentLockRaw = await readTextIfExists(paths.lockFile);
    const nextLockRaw = stableStringify(planResult.nextLock);
    if (currentLockRaw !== nextLockRaw) {
      await writeLock(paths, planResult.nextLock);
    }

    const currentManagedIndexRaw = await readTextIfExists(paths.managedIndexFile);
    const nextManagedIndexRaw = stableStringify(planResult.nextManagedIndex);
    if (currentManagedIndexRaw !== nextManagedIndexRaw) {
      await writeManagedIndex(paths, planResult.nextManagedIndex);
    }

    return {
      operations: planResult.operations,
      diagnostics,
      nextLock: planResult.nextLock,
      writtenArtifacts: writtenArtifacts.sort((left, right) => left.localeCompare(right)),
      prunedArtifacts: prunedArtifacts.sort((left, right) => left.localeCompare(right)),
    };
  }

  async watch(debounceMs = 250): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    const runApply = async (): Promise<void> => {
      const result = await this.apply();
      printDiagnostics(result.diagnostics);
      printApplySummary(result.writtenArtifacts, result.prunedArtifacts);
    };

    await runApply();

    const base = resolveHarnessPaths(this.cwd).agentsDir;
    const watcher = chokidar.watch(
      [
        path.join(base, "manifest.json"),
        path.join(base, "src/**/*.md"),
        path.join(base, "src/**/*.json"),
        path.join(base, "src/**/*.overrides.*.yaml"),
        path.join(base, "src/**/OVERRIDES.*.yaml"),
      ],
      {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 20,
        },
      },
    );

    let running = false;
    let rerun = false;
    let timeout: NodeJS.Timeout | null = null;

    const schedule = () => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(async () => {
        if (running) {
          rerun = true;
          return;
        }

        running = true;
        do {
          rerun = false;
          try {
            await runApply();
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown watch error";
            console.error(`[harness] watch apply failed: ${message}`);
          }
        } while (rerun);
        running = false;
      }, debounceMs);
    };

    watcher.on("add", schedule);
    watcher.on("change", schedule);
    watcher.on("unlink", schedule);
    watcher.on("error", (error) => {
      console.error(`[harness] watcher error: ${String(error)}`);
    });

    process.stdin.resume();
    await new Promise<void>(() => {
      // intentional never-resolve to keep foreground watch alive
    });
  }

  async doctor(_options?: { json?: boolean }): Promise<DoctorResult> {
    return runDoctor(resolveHarnessPaths(this.cwd));
  }

  async migrate(options?: {
    to?: "latest";
    dryRun?: boolean;
    json?: boolean;
  }): Promise<MigrationResult> {
    return runMigration(resolveHarnessPaths(this.cwd), {
      to: options?.to,
      dryRun: options?.dryRun,
    });
  }

  private async ensureOverrideFiles(
    entityType: EntityType,
    entityId: string,
    existing?: Partial<Record<ProviderId, string>>,
  ): Promise<{
    overrides: Partial<Record<ProviderId, string>>;
    overrideShaByProvider: Partial<Record<ProviderId, string>>;
  }> {
    const overrides: Partial<Record<ProviderId, string>> = {};
    const overrideShaByProvider: Partial<Record<ProviderId, string>> = {};

    for (const provider of providerIdSchema.options) {
      const overridePath =
        existing?.[provider] ??
        (entityType === "prompt"
          ? defaultPromptOverridePath(provider)
          : entityType === "skill"
            ? defaultSkillOverridePath(entityId, provider)
            : defaultMcpOverridePath(entityId, provider));
      overrides[provider] = overridePath;

      const absolute = path.join(this.cwd, overridePath);
      if (!(await exists(absolute))) {
        await ensureParentDir(absolute);
        await fs.writeFile(absolute, "version: 1\n", "utf8");
      }

      const text = await fs.readFile(absolute, "utf8");
      overrideShaByProvider[provider] = sha256(text);
    }

    return { overrides, overrideShaByProvider };
  }

  private async readCurrentSourceSha(entity: AgentsManifest["entities"][number]): Promise<string> {
    const sourceAbs = path.join(this.cwd, entity.sourcePath);
    if (entity.type === "prompt") {
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

    const skillRoot = path.join(this.cwd, `.harness/src/skills/${entity.id}`);
    const files = await this.loadSkillSourceHashes(skillRoot);
    return computeSkillSourceSha(files);
  }

  private async loadSkillSourceHashes(skillRootAbs: string): Promise<Array<{ path: string; sha256: string }>> {
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

  private async materializeFetchedEntity(
    entity: AgentsManifest["entities"][number],
    fetched: Awaited<ReturnType<typeof fetchEntityFromRegistry>>,
  ): Promise<void> {
    if (entity.type === "prompt" && fetched.type === "prompt") {
      const sourceAbs = path.join(this.cwd, entity.sourcePath);
      await ensureParentDir(sourceAbs);
      await fs.writeFile(sourceAbs, fetched.sourceText, "utf8");
      return;
    }

    if (entity.type === "mcp_config" && fetched.type === "mcp_config") {
      const sourceAbs = path.join(this.cwd, entity.sourcePath);
      await ensureParentDir(sourceAbs);
      await fs.writeFile(sourceAbs, stableStringify(fetched.sourceJson), "utf8");
      return;
    }

    if (entity.type === "skill" && fetched.type === "skill") {
      const skillRootAbs = path.join(this.cwd, `.harness/src/skills/${entity.id}`);
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

  private async readLockOrDefault(manifest: AgentsManifest): Promise<ManifestLock> {
    const lockResult = await loadLock(resolveHarnessPaths(this.cwd));
    if (lockResult.lock) {
      return lockResult.lock;
    }

    return {
      version: LATEST_VERSION_BY_KIND.lock as ManifestLock["version"],
      generatedAt: nowIso(),
      manifestFingerprint: sha256(JSON.stringify(manifest)),
      entities: [],
      outputs: [],
    };
  }

  private setLockEntityRecord(
    lock: ManifestLock,
    record: {
      id: string;
      type: EntityType;
      registry: RegistryId;
      sourceSha256: string;
      overrideSha256ByProvider: LockEntityRecord["overrideSha256ByProvider"];
      importedSourceSha256?: string;
      registryRevision?: RegistryRevision;
    },
  ): void {
    lock.entities = lock.entities.filter((entry) => !(entry.id === record.id && entry.type === record.type));
    lock.entities.push({
      id: record.id,
      type: record.type,
      registry: record.registry,
      sourceSha256: record.sourceSha256,
      overrideSha256ByProvider: record.overrideSha256ByProvider,
      importedSourceSha256: record.importedSourceSha256,
      registryRevision: record.registryRevision,
    });
    lock.entities.sort((left, right) => {
      const byType = left.type.localeCompare(right.type);
      if (byType !== 0) {
        return byType;
      }
      return left.id.localeCompare(right.id);
    });
  }

  private async upsertLockEntityRecord(
    paths: ReturnType<typeof resolveHarnessPaths>,
    manifest: AgentsManifest,
    record: {
      id: string;
      type: EntityType;
      registry: RegistryId;
      sourceSha256: string;
      overrideSha256ByProvider: LockEntityRecord["overrideSha256ByProvider"];
      importedSourceSha256?: string;
      registryRevision?: RegistryRevision;
    },
  ): Promise<void> {
    const lock = await this.readLockOrDefault(manifest);
    this.setLockEntityRecord(lock, record);
    lock.generatedAt = nowIso();
    lock.manifestFingerprint = sha256(JSON.stringify(manifest));
    await writeLock(paths, lock);
  }

  private async removeLockEntityRecord(
    paths: ReturnType<typeof resolveHarnessPaths>,
    manifest: AgentsManifest,
    type: EntityType,
    id: string,
  ): Promise<void> {
    const lock = await this.readLockOrDefault(manifest);
    lock.entities = lock.entities.filter((entry) => !(entry.type === type && entry.id === id));
    lock.generatedAt = nowIso();
    lock.manifestFingerprint = sha256(JSON.stringify(manifest));
    await writeLock(paths, lock);
  }

  private async writeManagedSourceIndex(
    paths: ReturnType<typeof resolveHarnessPaths>,
    manifest: AgentsManifest,
  ): Promise<void> {
    const index = await this.readManagedIndexOrDefault();
    index.managedSourcePaths = collectManagedSourcePaths(manifest);
    await writeManagedIndex(paths, index);
  }

  private async planInternal(): Promise<InternalPlanResult> {
    const paths = resolveHarnessPaths(this.cwd);
    const versionDiagnostics = await this.versionPreflightDiagnostics();
    if (versionDiagnostics.length > 0) {
      return {
        operations: [],
        diagnostics: versionDiagnostics,
        nextLock: {
          version: LATEST_VERSION_BY_KIND.lock as ManifestLock["version"],
          generatedAt: nowIso(),
          manifestFingerprint: sha256("{}"),
          entities: [],
          outputs: [],
        },
        artifactsByPath: new Map(),
        nextManagedIndex: emptyManagedIndex(),
      };
    }

    const manifestResult = await loadManifest(paths);
    const lockResult = await loadLock(paths);
    const managedIndexResult = await loadManagedIndex(paths);

    const diagnostics: Diagnostic[] = [
      ...manifestResult.diagnostics,
      ...lockResult.diagnostics,
      ...managedIndexResult.diagnostics,
    ];

    if (manifestResult.manifest === null) {
      return {
        operations: [],
        diagnostics,
        nextLock: {
          version: LATEST_VERSION_BY_KIND.lock as ManifestLock["version"],
          generatedAt: nowIso(),
          manifestFingerprint: sha256("{}"),
          entities: [],
          outputs: [],
        },
        artifactsByPath: new Map(),
        nextManagedIndex: managedIndexResult.managedIndex,
      };
    }

    const loaded = await loadCanonicalState(paths, manifestResult.manifest);
    const planResult = await buildPlan(
      paths,
      {
        ...loaded,
        diagnostics: [...diagnostics, ...loaded.diagnostics],
      },
      managedIndexResult.managedIndex,
      lockResult.lock,
    );

    return planResult;
  }

  private async readManifestOrThrow(): Promise<AgentsManifest> {
    const paths = resolveHarnessPaths(this.cwd);
    const result = await loadManifest(paths);
    if (result.manifest === null) {
      const diagnostic = result.diagnostics[0];
      if (diagnostic) {
        throw new Error(`${diagnostic.code}: ${diagnostic.message}`);
      }
      throw new Error("Manifest not found. Run 'harness init' first.");
    }
    return result.manifest;
  }

  private async readManagedIndexOrDefault(): Promise<ManagedIndex> {
    const paths = resolveHarnessPaths(this.cwd);
    const result = await loadManagedIndex(paths);
    return result.managedIndex;
  }

  private async assertWorkspaceVersionCurrent(options?: {
    allowMissingManifest?: boolean;
  }): Promise<void> {
    const diagnostics = await this.versionPreflightDiagnostics(options);
    if (diagnostics.length === 0) {
      return;
    }

    const hasNewerThanCli = diagnostics.some((diagnostic) => diagnostic.code.includes("NEWER_THAN_CLI"));
    const hasMissingWorkspace = diagnostics.some((diagnostic) => isMissingWorkspaceCode(diagnostic.code));
    const details = diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n");
    const hint = hasMissingWorkspace
      ? "Run 'harness init' first."
      : hasNewerThanCli
        ? "Install a newer harness CLI, then run 'harness doctor'."
        : "Run 'harness doctor' then 'harness migrate'.";
    throw new Error(`${details}\n${hint}`);
  }

  private async versionPreflightDiagnostics(options?: {
    allowMissingManifest?: boolean;
  }): Promise<Diagnostic[]> {
    const missingWorkspace = await this.workspaceInitializationDiagnostics(options);
    if (missingWorkspace.length > 0) {
      return missingWorkspace;
    }

    const doctor = await runDoctor(resolveHarnessPaths(this.cwd));
    let diagnostics = doctor.files.filter((status) => status.status !== "current");

    if (options?.allowMissingManifest) {
      diagnostics = diagnostics.filter((status) => status.code !== "MANIFEST_NOT_FOUND");
    }

    if (diagnostics.length === 0 || !hasVersionBlockers({ ...doctor, files: diagnostics })) {
      return [];
    }

    const preflightDoctor = {
      ...doctor,
      files: diagnostics,
      diagnostics: preflightDiagnosticsFromDoctor(doctor.diagnostics, diagnostics),
    };

    return buildVersionPreflightDiagnostics(preflightDoctor);
  }

  private async workspaceInitializationDiagnostics(options?: {
    allowMissingManifest?: boolean;
  }): Promise<Diagnostic[]> {
    if (options?.allowMissingManifest) {
      return [];
    }

    const paths = resolveHarnessPaths(this.cwd);
    if (await exists(paths.agentsDir)) {
      return [];
    }

    return [
      {
        code: "WORKSPACE_NOT_INITIALIZED",
        severity: "error",
        message: "Harness workspace directory '.harness' does not exist. Run 'harness init' first.",
        path: ".harness",
        hint: "Run 'harness init' first.",
      },
    ];
  }
}

function sortEntities(entities: AgentsManifest["entities"]): AgentsManifest["entities"] {
  const order: Record<EntityType, number> = {
    prompt: 0,
    skill: 1,
    mcp_config: 2,
  };

  return [...entities].sort((left, right) => {
    const typeOrder = order[left.type] - order[right.type];
    if (typeOrder !== 0) {
      return typeOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function validateEntityId(id: string, type: EntityType): void {
  if (!/^[a-zA-Z0-9._-]+$/u.test(id)) {
    throw new Error(`Invalid ${type} id '${id}'. Allowed characters: letters, digits, '.', '_', '-'`);
  }
}

function validateRegistryId(id: string): void {
  if (!/^[a-zA-Z0-9._-]+$/u.test(id)) {
    throw new Error(`Invalid registry id '${id}'. Allowed characters: letters, digits, '.', '_', '-'`);
  }
}

function registryIdFromInput(value: string): RegistryId {
  validateRegistryId(value);
  return value;
}

function resolveEntityRegistrySelection(
  manifest: AgentsManifest,
  explicitRegistry?: string,
): { id: RegistryId; definition: RegistryDefinition } {
  const registryId = explicitRegistry
    ? registryIdFromInput(explicitRegistry)
    : manifest.registries.default || DEFAULT_REGISTRY_ID;
  const definition = manifest.registries.entries[registryId];
  if (!definition) {
    throw new Error(`REGISTRY_NOT_FOUND: registry '${registryId}' is not configured`);
  }
  return { id: registryId, definition };
}

function manifestEntityTypeToCliEntityType(type: EntityType): CliEntityType {
  switch (type) {
    case "prompt":
      return "prompt";
    case "skill":
      return "skill";
    case "mcp_config":
      return "mcp";
  }
}

function isSkillOverrideFile(relativePath: string): boolean {
  return /^OVERRIDES\.[^.]+\.ya?ml$/u.test(path.basename(relativePath));
}

function computeSkillSourceSha(files: Array<{ path: string; sha256: string }>): string {
  const normalized = files
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableStringify(normalized));
}

async function listFilesRecursively(baseDir: string): Promise<string[]> {
  if (!(await exists(baseDir))) {
    return [];
  }

  const output: string[] = [];
  const queue = [baseDir];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
      } else if (entry.isFile()) {
        output.push(nextPath);
      }
    }
  }

  return output.sort((left, right) => left.localeCompare(right));
}

function resolveRemoveTargetId(entityType: CliEntityType, id: string): string {
  if (entityType !== "prompt") {
    return id;
  }

  if (id !== "system") {
    throw new Error(`Prompt entity id must be 'system', received '${id}'`);
  }

  return "system";
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return;
  }
  for (const diagnostic of diagnostics) {
    const suffix = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.error(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${suffix}`);
  }
}

function printApplySummary(writtenArtifacts: string[], prunedArtifacts: string[]): void {
  if (writtenArtifacts.length > 0) {
    console.log(`[harness] wrote ${writtenArtifacts.length} artifact(s)`);
  }

  if (prunedArtifacts.length > 0) {
    console.log(`[harness] removed ${prunedArtifacts.length} stale artifact(s)`);
  }
}

function preflightDiagnosticsFromDoctor(
  doctorDiagnostics: Diagnostic[],
  fileDiagnostics: Array<{ code: string }>,
): Diagnostic[] {
  if (doctorDiagnostics.length === 0) {
    return doctorDiagnostics;
  }

  const fileCodes = new Set(fileDiagnostics.map((status) => status.code));
  const filtered = doctorDiagnostics.filter((diagnostic) => fileCodes.has(diagnostic.code));
  return filtered.length > 0 ? filtered : doctorDiagnostics;
}

function isMissingWorkspaceCode(code: string): boolean {
  return code === "MANIFEST_NOT_FOUND" || code === "WORKSPACE_NOT_INITIALIZED";
}

export async function loadConfig(pathValue?: string): Promise<AgentsManifest> {
  const configPath = pathValue ? path.resolve(pathValue) : path.resolve(process.cwd(), ".harness/manifest.json");
  const text = await fs.readFile(configPath, "utf8");
  return agentsManifestSchema.parse(JSON.parse(text));
}

export function validateConfig(config: AgentsManifest): ValidationResult {
  const result = agentsManifestSchema.safeParse(config);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "MANIFEST_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export function validateLock(lock: ManifestLock): ValidationResult {
  const result = manifestLockSchema.safeParse(lock);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "LOCK_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export function validateManagedIndex(index: ManagedIndex): ValidationResult {
  const result = managedIndexSchema.safeParse(index);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "MANAGED_INDEX_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export async function loadOverride(pathValue: string): Promise<ProviderOverride> {
  const text = await fs.readFile(pathValue, "utf8");
  const YAML = await import("yaml");
  return (await import("@agent-harness/manifest-schema")).parseProviderOverride(YAML.parse(text));
}
