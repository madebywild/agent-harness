import fs from "node:fs/promises";
import path from "node:path";
import {
  agentsManifestSchema,
  managedIndexSchema,
  manifestLockSchema,
  parseProviderOverride,
  providerIdSchema,
} from "@agent-harness/manifest-schema";
import type { HarnessPaths } from "./paths.js";
import type { AgentsManifest, Diagnostic, ManagedIndex, ManifestLock, ProviderId, ProviderOverride } from "./types.js";
import {
  ensureParentDir,
  exists,
  normalizeRelativePath,
  readTextIfExists,
  stableStringify,
  toPosixRelative,
} from "./utils.js";

export async function loadManifest(
  paths: HarnessPaths,
): Promise<{ manifest: AgentsManifest | null; diagnostics: Diagnostic[] }> {
  const contents = await readTextIfExists(paths.manifestFile);
  if (contents === null) {
    return {
      manifest: null,
      diagnostics: [
        {
          code: "MANIFEST_NOT_FOUND",
          severity: "error",
          message: "Missing manifest file at .harness/manifest.json",
          path: ".harness/manifest.json",
          hint: "Run 'agent-harness init' first.",
        },
      ],
    };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const manifest = agentsManifestSchema.parse(parsed);
    return { manifest, diagnostics: [] };
  } catch (error) {
    return {
      manifest: null,
      diagnostics: [
        {
          code: "MANIFEST_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : "Manifest is invalid JSON or failed schema validation",
          path: ".harness/manifest.json",
        },
      ],
    };
  }
}

export async function writeManifest(paths: HarnessPaths, manifest: AgentsManifest): Promise<void> {
  await ensureParentDir(paths.manifestFile);
  await fs.writeFile(paths.manifestFile, stableStringify(manifest), "utf8");
}

export async function loadLock(paths: HarnessPaths): Promise<{
  lock: ManifestLock | null;
  diagnostics: Diagnostic[];
  raw: string | null;
}> {
  const contents = await readTextIfExists(paths.lockFile);
  if (contents === null) {
    return { lock: null, diagnostics: [], raw: null };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const lock = manifestLockSchema.parse(parsed);
    return { lock, diagnostics: [], raw: contents };
  } catch (error) {
    return {
      lock: null,
      raw: contents,
      diagnostics: [
        {
          code: "LOCK_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : "manifest.lock.json failed schema validation",
          path: ".harness/manifest.lock.json",
        },
      ],
    };
  }
}

export async function writeLock(paths: HarnessPaths, lock: ManifestLock): Promise<string> {
  const serialized = stableStringify(lock);
  await ensureParentDir(paths.lockFile);
  await fs.writeFile(paths.lockFile, serialized, "utf8");
  return serialized;
}

export function emptyManagedIndex(): ManagedIndex {
  return {
    version: 1,
    managedSourcePaths: [],
    managedOutputPaths: [],
  };
}

export async function loadManagedIndex(
  paths: HarnessPaths,
): Promise<{ managedIndex: ManagedIndex; diagnostics: Diagnostic[] }> {
  const contents = await readTextIfExists(paths.managedIndexFile);
  if (contents === null) {
    return { managedIndex: emptyManagedIndex(), diagnostics: [] };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    return { managedIndex: managedIndexSchema.parse(parsed), diagnostics: [] };
  } catch (error) {
    return {
      managedIndex: emptyManagedIndex(),
      diagnostics: [
        {
          code: "MANAGED_INDEX_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : "managed-index failed schema validation",
          path: ".harness/managed-index.json",
        },
      ],
    };
  }
}

export async function writeManagedIndex(paths: HarnessPaths, managedIndex: ManagedIndex): Promise<void> {
  await ensureParentDir(paths.managedIndexFile);
  await fs.writeFile(paths.managedIndexFile, stableStringify(managedIndex), "utf8");
}

export async function readProviderOverrideFile(
  rootDir: string,
  provider: ProviderId,
  overridePath?: string,
): Promise<{
  override: ProviderOverride | undefined;
  sha256: string | undefined;
  diagnostics: Diagnostic[];
}> {
  if (!overridePath) {
    return { override: undefined, sha256: undefined, diagnostics: [] };
  }

  const normalized = normalizeRelativePath(overridePath);
  const absolute = path.join(rootDir, normalized);
  const text = await readTextIfExists(absolute);

  if (text === null) {
    return { override: undefined, sha256: undefined, diagnostics: [] };
  }

  try {
    const YAML = await import("yaml");
    const parsed = YAML.parse(text) as unknown;
    const override = parseProviderOverride(parsed);
    const { sha256 } = await import("./utils.js");
    return { override, sha256: sha256(text), diagnostics: [] };
  } catch (error) {
    return {
      override: undefined,
      sha256: undefined,
      diagnostics: [
        {
          code: "OVERRIDE_INVALID",
          severity: "error",
          message: `Invalid override YAML for provider '${provider}': ${error instanceof Error ? error.message : "unknown error"}`,
          path: normalized,
          provider,
        },
      ],
    };
  }
}

export async function listFilesRecursively(baseDir: string): Promise<string[]> {
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

export async function collectSourceCandidates(paths: HarnessPaths): Promise<string[]> {
  const files = await listFilesRecursively(paths.srcDir);
  const candidates: string[] = [];

  for (const file of files) {
    const relative = toPosixRelative(file, paths.root);

    if (/^\.harness\/src\/prompts\/[^/]+\.md$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/skills\/[^/]+\/SKILL\.md$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/mcp\/[^/]+\.json$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/prompts\/[^/]+\.overrides\.[^.\/]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/skills\/[^/]+\/OVERRIDES\.[^.\/]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/mcp\/[^/]+\.overrides\.[^.\/]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
    }
  }

  return candidates.sort((left, right) => left.localeCompare(right));
}

export function collectManagedSourcePaths(manifest: AgentsManifest): string[] {
  const paths = new Set<string>();
  for (const entity of manifest.entities) {
    paths.add(normalizeRelativePath(entity.sourcePath));
    if (entity.overrides) {
      for (const provider of providerIdSchema.options) {
        const overridePath = entity.overrides[provider];
        if (overridePath) {
          paths.add(normalizeRelativePath(overridePath));
        }
      }
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

export async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch {
    // ignore best-effort deletes for stale generated outputs
  }
}
