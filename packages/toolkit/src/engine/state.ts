import { LATEST_VERSION_BY_KIND } from "@madebywild/agent-harness-manifest";
import type { HarnessPaths } from "../paths.js";
import {
  collectManagedSourcePaths,
  loadLock,
  loadManagedIndex,
  loadManifest,
  writeLock,
  writeManagedIndex,
} from "../repository.js";
import type {
  AgentsManifest,
  EntityType,
  LockEntityRecord,
  ManagedIndex,
  ManifestLock,
  RegistryId,
  RegistryRevision,
} from "../types.js";
import { nowIso, sha256 } from "../utils.js";

export async function readManifestOrThrow(paths: HarnessPaths): Promise<AgentsManifest> {
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

export async function readLockOrDefault(paths: HarnessPaths, manifest: AgentsManifest): Promise<ManifestLock> {
  const lockResult = await loadLock(paths);
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

export async function readManagedIndexOrDefault(paths: HarnessPaths): Promise<ManagedIndex> {
  const result = await loadManagedIndex(paths);
  return result.managedIndex;
}

export type LockEntityRecordInput = {
  id: string;
  type: EntityType;
  registry: RegistryId;
  sourceSha256: string;
  overrideSha256ByProvider: LockEntityRecord["overrideSha256ByProvider"];
  importedSourceSha256?: string;
  registryRevision?: RegistryRevision;
};

export function setLockEntityRecord(lock: ManifestLock, record: LockEntityRecordInput): void {
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

export async function upsertLockEntityRecord(
  paths: HarnessPaths,
  manifest: AgentsManifest,
  record: LockEntityRecordInput,
): Promise<void> {
  const lock = await readLockOrDefault(paths, manifest);
  setLockEntityRecord(lock, record);
  lock.generatedAt = nowIso();
  lock.manifestFingerprint = sha256(JSON.stringify(manifest));
  await writeLock(paths, lock);
}

export async function removeLockEntityRecord(
  paths: HarnessPaths,
  manifest: AgentsManifest,
  type: EntityType,
  id: string,
): Promise<void> {
  const lock = await readLockOrDefault(paths, manifest);
  lock.entities = lock.entities.filter((entry) => !(entry.type === type && entry.id === id));
  lock.generatedAt = nowIso();
  lock.manifestFingerprint = sha256(JSON.stringify(manifest));
  await writeLock(paths, lock);
}

export async function writeManagedSourceIndex(paths: HarnessPaths, manifest: AgentsManifest): Promise<void> {
  const index = await readManagedIndexOrDefault(paths);
  index.managedSourcePaths = collectManagedSourcePaths(manifest);
  await writeManagedIndex(paths, index);
}
