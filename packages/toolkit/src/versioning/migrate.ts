import path from "node:path";
import {
  type AgentsManifest,
  type DocumentKind,
  detectDocumentVersion,
  LATEST_VERSION_BY_KIND,
  parseManifest,
  parseProviderOverride,
} from "@madebywild/agent-harness-manifest";
import { loadCanonicalState } from "../loader.js";
import type { HarnessPaths } from "../paths.js";
import { buildPlan } from "../planner.js";
import { copyWorkspaceFileToBackup, emptyManagedIndex } from "../repository.js";
import type {
  Diagnostic,
  ManagedIndex,
  ManifestLock,
  MigrationAction,
  MigrationResult,
  ProviderId,
  VersionDiagnostic,
} from "../types.js";
import { readTextIfExists, stableStringify, withSingleTrailingNewline, writeFileAtomic } from "../utils.js";
import { runDoctor } from "./doctor.js";
import { defaultMigrationRegistry, resolveMigrationChain, runMigrationChain } from "./registry.js";

interface MigrateWorkspaceOptions {
  to?: "latest";
  dryRun?: boolean;
}

interface PendingWrite {
  kind: DocumentKind;
  path: string;
  content: string;
  details: string;
  action: MigrationAction["action"];
}

export async function runMigration(
  paths: HarnessPaths,
  options: MigrateWorkspaceOptions = {},
): Promise<MigrationResult> {
  if (options.to && options.to !== "latest") {
    return {
      success: false,
      dryRun: options.dryRun === true,
      actions: [],
      diagnostics: [
        {
          code: "MIGRATION_TARGET_UNSUPPORTED",
          severity: "error",
          message: `Unsupported migration target '${options.to}'. Only 'latest' is supported.`,
          path: ".harness",
        },
      ],
    };
  }

  const dryRun = options.dryRun === true;
  const doctor = await runDoctor(paths);
  const actions: MigrationAction[] = [];

  const unsupported = doctor.files.filter((file) => file.status === "unsupported");
  if (unsupported.length > 0) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: [
        {
          code: "MIGRATION_DOWNGRADE_UNSUPPORTED",
          severity: "error",
          message: "Cannot migrate because one or more files use a newer schema than this CLI supports.",
          path: ".harness",
          hint: "Install a newer harness CLI and rerun 'harness doctor'.",
        },
        ...doctor.diagnostics,
      ],
    };
  }

  const invalid = doctor.files.filter((file) => file.status === "invalid" || file.status === "missing");
  if (invalid.length > 0) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: [
        {
          code: "MIGRATION_BLOCKED_INVALID",
          severity: "error",
          message: "Migration is blocked by invalid or missing version metadata.",
          path: ".harness",
          hint: "Fix diagnostics from 'harness doctor' and rerun migration.",
        },
        ...doctor.diagnostics,
      ],
    };
  }

  const outdated = doctor.files.filter((file) => file.status === "outdated");
  if (outdated.length === 0) {
    actions.push({
      kind: "backup",
      path: ".harness",
      action: "noop",
      details: "Workspace is already on latest schema version",
    });
    return {
      success: true,
      dryRun,
      actions,
      diagnostics: [],
    };
  }

  const manifestText = await readTextIfExists(paths.manifestFile);
  if (manifestText === null) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: [
        {
          code: "MANIFEST_NOT_FOUND",
          severity: "error",
          message: "Missing manifest file at .harness/manifest.json",
          path: ".harness/manifest.json",
          hint: "Run 'harness init' first.",
        },
      ],
    };
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestText) as unknown;
  } catch (error) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: [
        {
          code: "MANIFEST_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : "Manifest must be valid JSON",
          path: ".harness/manifest.json",
        },
      ],
    };
  }

  let migratedManifest: AgentsManifest;
  try {
    migratedManifest = (await migrateVersionedObject("manifest", parsedManifest)) as AgentsManifest;
  } catch (error) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: [toMigrationErrorDiagnostic(error, ".harness/manifest.json", "MANIFEST_MIGRATION_FAILED")],
    };
  }

  const pendingWrites: PendingWrite[] = [];

  for (const file of outdated.filter((status) => status.kind === "provider-override")) {
    const overrideWrite = await buildOverrideWrite(paths, file);
    if (overrideWrite.diagnostic) {
      return {
        success: false,
        dryRun,
        actions,
        diagnostics: [overrideWrite.diagnostic],
      };
    }

    if (overrideWrite.write) {
      pendingWrites.push(overrideWrite.write);
    }
  }

  const derived = await deriveLatestState(paths, migratedManifest);
  if (derived.diagnostics.length > 0) {
    return {
      success: false,
      dryRun,
      actions,
      diagnostics: derived.diagnostics,
    };
  }

  const manifestContent = stableStringify(migratedManifest);
  const lockContent = stableStringify(derived.lock);
  const managedIndexContent = stableStringify(derived.managedIndex);

  const manifestWrite = await maybeWrite(
    paths.root,
    "manifest",
    ".harness/manifest.json",
    manifestContent,
    "Manifest schema migrated",
  );
  if (manifestWrite) {
    pendingWrites.push(manifestWrite);
  }

  const lockWrite = await maybeWrite(
    paths.root,
    "lock",
    ".harness/manifest.lock.json",
    lockContent,
    "Rebuilt lock from desired outputs",
  );
  if (lockWrite) {
    pendingWrites.push(lockWrite);
  }

  const managedIndexWrite = await maybeWrite(
    paths.root,
    "managed-index",
    ".harness/managed-index.json",
    managedIndexContent,
    "Rebuilt managed-index and adopted desired output paths",
  );
  if (managedIndexWrite) {
    pendingWrites.push(managedIndexWrite);
  }

  for (const write of pendingWrites) {
    actions.push({
      kind: write.kind,
      path: write.path,
      action: write.action,
      details: write.details,
    });
  }

  if (pendingWrites.length === 0) {
    return {
      success: true,
      dryRun,
      actions: [
        {
          kind: "backup",
          path: ".harness",
          action: "noop",
          details: "No file content changes required",
        },
      ],
      diagnostics: [],
    };
  }

  const backupRoot = path.join(paths.agentsDir, ".backup", migrationTimestamp());
  const backupTargets: string[] = [];
  for (const write of pendingWrites) {
    const existing = await readTextIfExists(path.join(paths.root, write.path));
    if (existing !== null) {
      backupTargets.push(write.path);
    }
  }

  for (const target of backupTargets) {
    actions.push({
      kind: "backup",
      path: target,
      action: "backup",
      details: `Snapshot to ${path.posix.join(".harness/.backup", path.basename(backupRoot), target)}`,
    });
  }

  if (dryRun) {
    return {
      success: true,
      dryRun,
      backupRoot,
      actions,
      diagnostics: [],
    };
  }

  for (const target of backupTargets) {
    await copyWorkspaceFileToBackup(paths, target, backupRoot);
  }

  const writeOrder = sortWriteOrder(pendingWrites);
  for (const write of writeOrder) {
    await writeFileAtomic(path.join(paths.root, write.path), write.content);
  }

  return {
    success: true,
    dryRun,
    backupRoot,
    actions,
    diagnostics: [],
  };
}

async function buildOverrideWrite(
  paths: HarnessPaths,
  file: VersionDiagnostic,
): Promise<{ write?: PendingWrite; diagnostic?: Diagnostic }> {
  const absolute = path.join(paths.root, file.path ?? "");
  const text = await readTextIfExists(absolute);
  if (text === null) {
    return {
      diagnostic: {
        code: "OVERRIDE_MIGRATION_FAILED",
        severity: "error",
        message: `Missing override file '${file.path}'`,
        path: file.path,
      },
    };
  }

  try {
    const YAML = await import("yaml");
    const parsed = YAML.parse(text) as unknown;
    const migrated = await migrateVersionedObject("provider-override", parsed);
    const serialized = withSingleTrailingNewline(YAML.stringify(migrated));
    const write = await maybeWrite(
      paths.root,
      "provider-override",
      file.path ?? "",
      serialized,
      "Override schema migrated",
    );
    return { write: write ?? undefined };
  } catch (error) {
    return {
      diagnostic: toMigrationErrorDiagnostic(error, file.path, "OVERRIDE_MIGRATION_FAILED", file.provider),
    };
  }
}

async function migrateVersionedObject(kind: DocumentKind, input: unknown): Promise<unknown> {
  const detected = detectDocumentVersion(kind, input);

  if (detected.status !== "ok") {
    throw new Error(`Cannot migrate ${kind}: missing or invalid version field`);
  }

  if (detected.version === undefined) {
    throw new Error(`Cannot migrate ${kind}: missing version value`);
  }

  const targetVersion = LATEST_VERSION_BY_KIND[kind];
  if (detected.version > targetVersion) {
    throw new Error(`Cannot migrate ${kind} from newer version ${detected.version}`);
  }

  if (detected.version === targetVersion) {
    return parseAsCurrent(kind, input);
  }

  const chain = resolveMigrationChain(defaultMigrationRegistry, kind, detected.version, targetVersion);

  if (chain === null) {
    // No migration chain available — fall back to bumping version and re-parsing.
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`Cannot migrate ${kind}: expected object document`);
    }

    const bumped = {
      ...(input as Record<string, unknown>),
      version: targetVersion,
    };
    return parseAsCurrent(kind, bumped);
  }

  const migrated = await runMigrationChain(defaultMigrationRegistry, kind, detected.version, targetVersion, input);
  return parseAsCurrent(kind, migrated.output);
}

function parseAsCurrent(kind: DocumentKind, input: unknown): unknown {
  switch (kind) {
    case "manifest":
      return parseManifest(input);
    case "provider-override":
      return parseProviderOverride(input);
    case "lock":
      return input;
    case "managed-index":
      return input;
  }
}

async function deriveLatestState(
  paths: HarnessPaths,
  manifest: AgentsManifest,
): Promise<{
  lock: ManifestLock;
  managedIndex: ManagedIndex;
  diagnostics: Diagnostic[];
}> {
  const loaded = await loadCanonicalState(paths, manifest);
  const firstPass = await buildPlan(paths, loaded, emptyManagedIndex(), null);

  const blockingDiagnostics = firstPass.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.code !== "OUTPUT_COLLISION_UNMANAGED",
  );

  if (blockingDiagnostics.length > 0) {
    return {
      lock: firstPass.nextLock,
      managedIndex: firstPass.nextManagedIndex,
      diagnostics: blockingDiagnostics,
    };
  }

  const secondPass = await buildPlan(
    paths,
    loaded,
    {
      version: LATEST_VERSION_BY_KIND["managed-index"] as ManagedIndex["version"],
      managedSourcePaths: firstPass.nextManagedIndex.managedSourcePaths,
      managedOutputPaths: firstPass.nextManagedIndex.managedOutputPaths,
    },
    null,
  );

  const secondBlocking = secondPass.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  return {
    lock: secondPass.nextLock,
    managedIndex: secondPass.nextManagedIndex,
    diagnostics: secondBlocking,
  };
}

async function maybeWrite(
  rootAbs: string,
  kind: DocumentKind,
  relativePath: string,
  content: string,
  details: string,
): Promise<PendingWrite | null> {
  const absolute = path.join(rootAbs, relativePath);
  const existing = await readTextIfExists(absolute);
  if (existing === content) {
    return null;
  }

  return {
    kind,
    path: relativePath,
    content,
    details,
    action: kind === "provider-override" ? "migrate" : "rewrite",
  };
}

function sortWriteOrder(writes: PendingWrite[]): PendingWrite[] {
  const order: Record<DocumentKind, number> = {
    "provider-override": 0,
    lock: 1,
    "managed-index": 2,
    manifest: 3,
  };

  return [...writes].sort((left, right) => {
    const byKind = order[left.kind] - order[right.kind];
    if (byKind !== 0) {
      return byKind;
    }

    return left.path.localeCompare(right.path);
  });
}

function toMigrationErrorDiagnostic(
  error: unknown,
  pathValue: string | undefined,
  code: string,
  provider?: ProviderId,
): Diagnostic {
  return {
    code,
    severity: "error",
    message: error instanceof Error ? error.message : "Migration failed",
    path: pathValue,
    provider,
  };
}

function migrationTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
