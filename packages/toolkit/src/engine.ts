import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_REGISTRY_ID } from "@agent-harness/manifest-schema";
import type { ProviderId } from "@agent-harness/manifest-schema";
import { LATEST_VERSION_BY_KIND } from "@agent-harness/manifest-schema";
import chokidar from "chokidar";
import {
  addMcpEntity,
  addPromptEntity,
  addSkillEntity,
  pullRegistryEntities,
  removeEntity,
} from "./engine/entities.js";
import { readManifestOrThrow } from "./engine/state.js";
import {
  isMissingWorkspaceCode,
  preflightDiagnosticsFromDoctor,
  printApplySummary,
  printDiagnostics,
  validateRegistryId,
} from "./engine/utils.js";
import { loadCanonicalState } from "./loader.js";
import { resolveHarnessPaths } from "./paths.js";
import { buildPlan } from "./planner.js";
import {
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
  InternalPlanResult,
  ManagedIndex,
  ManifestLock,
  MigrationResult,
  PlanResult,
  RegistryListEntry,
  RegistryPullResult,
  RemoveResult,
  ValidationResult,
} from "./types.js";
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
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));
    if (!manifest.providers.enabled.includes(provider)) {
      manifest.providers.enabled = uniqSorted([...manifest.providers.enabled, provider]) as ProviderId[];
      await writeManifest(resolveHarnessPaths(this.cwd), manifest);
    }
  }

  async disableProvider(provider: ProviderId): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));
    manifest.providers.enabled = manifest.providers.enabled.filter((entry) => entry !== provider);
    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async listRegistries(): Promise<RegistryListEntry[]> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));
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
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));

    if (manifest.registries.entries[name]) {
      throw new Error(`Registry '${name}' already exists`);
    }

    manifest.registries.entries[name] = {
      type: "git",
      url: options.gitUrl,
      ref: options.ref ?? "main",
      rootPath:
        options.rootPath === "." || options.rootPath === "./"
          ? undefined
          : options.rootPath
            ? normalizeRelativePath(options.rootPath)
            : undefined,
      tokenEnvVar: options.tokenEnvVar,
    };

    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async removeRegistry(name: string): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    validateRegistryId(name);
    const paths = resolveHarnessPaths(this.cwd);
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));

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
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));
    if (!manifest.registries.entries[name]) {
      throw new Error(`REGISTRY_NOT_FOUND: registry '${name}' is not configured`);
    }

    manifest.registries.default = name;
    await writeManifest(resolveHarnessPaths(this.cwd), manifest);
  }

  async getDefaultRegistry(): Promise<string> {
    await this.assertWorkspaceVersionCurrent();
    const manifest = await readManifestOrThrow(resolveHarnessPaths(this.cwd));
    return manifest.registries.default;
  }

  async addPrompt(options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    await addPromptEntity(this.cwd, options);
  }

  async addSkill(skillId: string, options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    await addSkillEntity(this.cwd, skillId, options);
  }

  async addMcp(configId: string, options?: { registry?: string }): Promise<void> {
    await this.assertWorkspaceVersionCurrent();
    await addMcpEntity(this.cwd, configId, options);
  }

  async pullRegistry(options?: {
    entityType?: CliEntityType;
    id?: string;
    registry?: string;
    force?: boolean;
  }): Promise<RegistryPullResult> {
    await this.assertWorkspaceVersionCurrent();
    return pullRegistryEntities(this.cwd, options);
  }

  async remove(entityTypeArg: CliEntityType, id: string, deleteSource: boolean): Promise<RemoveResult> {
    await this.assertWorkspaceVersionCurrent();
    return removeEntity(this.cwd, entityTypeArg, id, deleteSource);
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
