import fs from "node:fs/promises";
import path from "node:path";
import { providerIdSchema } from "@agent-harness/manifest-schema";
import type { ProviderId } from "@agent-harness/manifest-schema";
import {
  LATEST_VERSION_BY_KIND,
  agentsManifestSchema,
  managedIndexSchema,
  manifestLockSchema,
} from "@agent-harness/manifest-schema";
import chokidar from "chokidar";
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
  ManagedIndex,
  ManifestLock,
  MigrationResult,
  PlanResult,
  ProviderOverride,
  RemoveResult,
  ValidationResult,
} from "./types.js";
import { CLI_ENTITY_TO_MANIFEST_ENTITY } from "./types.js";
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
      version: 1,
      providers: {
        enabled: [],
      },
      entities: [],
    };

    const lock: ManifestLock = {
      version: 1,
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

  async addPrompt(): Promise<void> {
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

    await ensureParentDir(sourceAbs);
    await fs.writeFile(sourceAbs, "# System Prompt\n\nDescribe the core behavior for the assistant.\n", "utf8");

    const overrides: Partial<Record<ProviderId, string>> = {};
    for (const provider of providerIdSchema.options) {
      const overridePath = defaultPromptOverridePath(provider);
      overrides[provider] = overridePath;
      const overrideAbs = path.join(this.cwd, overridePath);
      await ensureParentDir(overrideAbs);
      await fs.writeFile(overrideAbs, "version: 1\n", "utf8");
    }

    manifest.entities.push({
      id: "system",
      type: "prompt",
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);

    const index = await this.readManagedIndexOrDefault();
    index.managedSourcePaths = collectManagedSourcePaths(manifest);
    await writeManagedIndex(paths, index);
  }

  async addSkill(skillId: string): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateEntityId(skillId, "skill");
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await this.readManifestOrThrow();

    if (manifest.entities.some((entity) => entity.type === "skill" && entity.id === skillId)) {
      throw new Error(`Skill '${skillId}' already exists`);
    }

    const sourcePath = defaultSkillSourcePath(skillId);
    const sourceAbs = path.join(this.cwd, sourcePath);
    if (await exists(sourceAbs)) {
      throw new Error(`Cannot add skill because '${sourcePath}' already exists`);
    }

    await ensureParentDir(sourceAbs);
    await fs.writeFile(
      sourceAbs,
      `---\nname: ${skillId}\ndescription: Describe what this skill does.\n---\n\n# ${skillId}\n\nAdd usage guidance here.\n`,
      "utf8",
    );

    const overrides: Partial<Record<ProviderId, string>> = {};
    for (const provider of providerIdSchema.options) {
      const overridePath = defaultSkillOverridePath(skillId, provider);
      overrides[provider] = overridePath;
      const overrideAbs = path.join(this.cwd, overridePath);
      await ensureParentDir(overrideAbs);
      await fs.writeFile(overrideAbs, "version: 1\n", "utf8");
    }

    manifest.entities.push({
      id: skillId,
      type: "skill",
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);

    const index = await this.readManagedIndexOrDefault();
    index.managedSourcePaths = collectManagedSourcePaths(manifest);
    await writeManagedIndex(paths, index);
  }

  async addMcp(configId: string): Promise<void> {
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

    await ensureParentDir(sourceAbs);
    await fs.writeFile(
      sourceAbs,
      stableStringify({
        servers: {
          [configId]: {
            command: "echo",
            args: ["configure-this-mcp-server"],
          },
        },
      }),
      "utf8",
    );

    const overrides: Partial<Record<ProviderId, string>> = {};
    for (const provider of providerIdSchema.options) {
      const overridePath = defaultMcpOverridePath(configId, provider);
      overrides[provider] = overridePath;
      const overrideAbs = path.join(this.cwd, overridePath);
      await ensureParentDir(overrideAbs);
      await fs.writeFile(overrideAbs, "version: 1\n", "utf8");
    }

    manifest.entities.push({
      id: configId,
      type: "mcp_config",
      sourcePath,
      overrides,
      enabled: true,
    });
    manifest.entities = sortEntities(manifest.entities);

    await writeManifest(paths, manifest);

    const index = await this.readManagedIndexOrDefault();
    index.managedSourcePaths = collectManagedSourcePaths(manifest);
    await writeManagedIndex(paths, index);
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

    const index = await this.readManagedIndexOrDefault();
    index.managedSourcePaths = collectManagedSourcePaths(manifest);
    await writeManagedIndex(paths, index);

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

  async migrate(options?: { to?: "latest"; dryRun?: boolean; json?: boolean }): Promise<MigrationResult> {
    return runMigration(resolveHarnessPaths(this.cwd), {
      to: options?.to,
      dryRun: options?.dryRun,
    });
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

  private async assertWorkspaceVersionCurrent(options?: { allowMissingManifest?: boolean }): Promise<void> {
    const diagnostics = await this.versionPreflightDiagnostics(options);
    if (diagnostics.length === 0) {
      return;
    }

    const hasNewerThanCli = diagnostics.some((diagnostic) => diagnostic.code.includes("NEWER_THAN_CLI"));
    const hasMissingManifest = diagnostics.some((diagnostic) => diagnostic.code === "MANIFEST_NOT_FOUND");
    const details = diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n");
    const hint = hasMissingManifest
      ? "Run 'harness init' first."
      : hasNewerThanCli
        ? "Install a newer harness CLI, then run 'harness doctor'."
        : "Run 'harness doctor' then 'harness migrate'.";
    throw new Error(`${details}\n${hint}`);
  }

  private async versionPreflightDiagnostics(options?: { allowMissingManifest?: boolean }): Promise<Diagnostic[]> {
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
      diagnostics:
        doctor.diagnostics.length > 0
          ? doctor.diagnostics.filter((diagnostic) => diagnostic.code !== "MANIFEST_NOT_FOUND")
          : doctor.diagnostics,
    };

    return buildVersionPreflightDiagnostics(preflightDoctor);
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
