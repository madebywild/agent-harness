import fs from "node:fs/promises";
import path from "node:path";
import {
  parseManagedIndex,
  parseManifest,
  parseManifestLock,
  parseProviderOverride,
  providerIdSchema,
  VersionError,
} from "@madebywild/agent-harness-manifest";
import { pushUnresolvedEnvDiagnostics, substituteEnvVars } from "./env.js";
import type { HarnessPaths } from "./paths.js";
import type {
  AgentsManifest,
  Diagnostic,
  ManagedIndex,
  ManifestLock,
  ProviderId,
  ProviderOverride,
  VersionStatus,
} from "./types.js";
import {
  copyToBackup,
  exists,
  normalizeRelativePath,
  readTextIfExists,
  stableStringify,
  toPosixRelative,
  writeFileAtomic,
} from "./utils.js";

type VersionIssue = VersionStatus;

export async function loadManifest(paths: HarnessPaths): Promise<{
  manifest: AgentsManifest | null;
  diagnostics: Diagnostic[];
  versionStatus?: VersionIssue;
}> {
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
          hint: "Run 'harness init' first.",
        },
      ],
    };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const manifest = parseManifest(parsed);
    return { manifest, diagnostics: [], versionStatus: "current" };
  } catch (error) {
    if (error instanceof VersionError) {
      const diagnostic = versionErrorDiagnostic("manifest", ".harness/manifest.json", error);
      return {
        manifest: null,
        diagnostics: [diagnostic],
        versionStatus: statusForVersionReason(error.reason),
      };
    }

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
  await writeFileAtomic(paths.manifestFile, stableStringify(manifest));
}

export async function loadLock(paths: HarnessPaths): Promise<{
  lock: ManifestLock | null;
  diagnostics: Diagnostic[];
  raw: string | null;
  versionStatus?: VersionIssue;
}> {
  const contents = await readTextIfExists(paths.lockFile);
  if (contents === null) {
    return { lock: null, diagnostics: [], raw: null };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    const lock = parseManifestLock(parsed);
    return { lock, diagnostics: [], raw: contents, versionStatus: "current" };
  } catch (error) {
    if (error instanceof VersionError) {
      const diagnostic = versionErrorDiagnostic("lock", ".harness/manifest.lock.json", error);
      return {
        lock: null,
        raw: contents,
        diagnostics: [diagnostic],
        versionStatus: statusForVersionReason(error.reason),
      };
    }

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
  await writeFileAtomic(paths.lockFile, serialized);
  return serialized;
}

export function emptyManagedIndex(): ManagedIndex {
  return {
    version: 1,
    managedSourcePaths: [],
    managedOutputPaths: [],
  };
}

export async function loadManagedIndex(paths: HarnessPaths): Promise<{
  managedIndex: ManagedIndex;
  diagnostics: Diagnostic[];
  versionStatus?: VersionIssue;
}> {
  const contents = await readTextIfExists(paths.managedIndexFile);
  if (contents === null) {
    return { managedIndex: emptyManagedIndex(), diagnostics: [] };
  }

  try {
    const parsed = JSON.parse(contents) as unknown;
    return {
      managedIndex: parseManagedIndex(parsed),
      diagnostics: [],
      versionStatus: "current",
    };
  } catch (error) {
    if (error instanceof VersionError) {
      return {
        managedIndex: emptyManagedIndex(),
        diagnostics: [versionErrorDiagnostic("managed-index", ".harness/managed-index.json", error)],
        versionStatus: statusForVersionReason(error.reason),
      };
    }

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
  await writeFileAtomic(paths.managedIndexFile, stableStringify(managedIndex));
}

export async function readProviderOverrideFile(
  rootDir: string,
  provider: ProviderId,
  overridePath?: string,
  envVars?: Map<string, string>,
): Promise<{
  override: ProviderOverride | undefined;
  sha256: string | undefined;
  diagnostics: Diagnostic[];
  versionStatus?: VersionIssue;
}> {
  if (!overridePath) {
    return {
      override: undefined,
      sha256: undefined,
      diagnostics: [],
      versionStatus: "current",
    };
  }

  const normalized = normalizeRelativePath(overridePath);
  const absolute = path.join(rootDir, normalized);
  const text = await readTextIfExists(absolute);

  if (text === null) {
    return {
      override: undefined,
      sha256: undefined,
      diagnostics: [],
      versionStatus: "current",
    };
  }

  const overrideDiagnostics: Diagnostic[] = [];
  try {
    let textToParse = text;
    if (envVars) {
      const { result, unresolvedKeys } = substituteEnvVars(text, envVars);
      textToParse = result;
      pushUnresolvedEnvDiagnostics(unresolvedKeys, overrideDiagnostics, normalized, { provider });
    }
    const YAML = await import("yaml");
    const parsed = YAML.parse(textToParse) as unknown;
    const override = parseProviderOverride(parsed);
    const { sha256 } = await import("./utils.js");
    return {
      override,
      sha256: sha256(text),
      diagnostics: overrideDiagnostics,
      versionStatus: "current",
    };
  } catch (error) {
    if (error instanceof VersionError) {
      return {
        override: undefined,
        sha256: undefined,
        diagnostics: [...overrideDiagnostics, versionErrorDiagnostic("provider-override", normalized, error, provider)],
        versionStatus: statusForVersionReason(error.reason),
      };
    }

    return {
      override: undefined,
      sha256: undefined,
      diagnostics: [
        ...overrideDiagnostics,
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

    if (/^\.harness\/src\/subagents\/[^/]+\.md$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/hooks\/[^/]+\.json$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/commands\/[^/]+\.md$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/prompts\/[^/]+\.overrides\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/skills\/[^/]+\/OVERRIDES\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/mcp\/[^/]+\.overrides\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/subagents\/[^/]+\.overrides\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/hooks\/[^/]+\.overrides\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      continue;
    }

    if (/^\.harness\/src\/commands\/[^/]+\.overrides\.[^./]+\.ya?ml$/u.test(relative)) {
      candidates.push(relative);
      // biome-ignore lint/complexity/noUselessContinue: defensive consistency with surrounding patterns
      continue;
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

export async function copyWorkspaceFileToBackup(
  paths: HarnessPaths,
  relativePath: string,
  backupRoot: string,
): Promise<boolean> {
  return copyToBackup(paths.root, relativePath, backupRoot);
}

function statusForVersionReason(reason: VersionError["reason"]): VersionIssue {
  switch (reason) {
    case "outdated_version":
      return "outdated";
    case "unsupported_version":
      return "unsupported";
    case "missing_version":
      return "missing";
    case "invalid_version_type":
      return "invalid";
  }
}

function versionErrorDiagnostic(
  kind: "manifest" | "lock" | "managed-index" | "provider-override",
  filePath: string,
  error: VersionError,
  provider?: ProviderId,
): Diagnostic {
  const prefix = kind === "provider-override" ? "OVERRIDE" : kind.toUpperCase().replaceAll("-", "_");
  const codeSuffix = versionCodeSuffix(error.reason);
  return {
    code: `${prefix}_VERSION_${codeSuffix}`,
    severity: "error",
    message: error.message,
    path: filePath,
    provider,
    hint:
      error.reason === "unsupported_version"
        ? "Install a newer harness CLI that supports this schema version."
        : "Run 'harness doctor' then 'harness migrate'.",
  };
}

function versionCodeSuffix(reason: VersionError["reason"]): string {
  switch (reason) {
    case "unsupported_version":
      return "NEWER_THAN_CLI";
    case "outdated_version":
      return "OUTDATED";
    case "missing_version":
      return "MISSING";
    case "invalid_version_type":
      return "INVALID";
  }
}
