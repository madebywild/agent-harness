import path from "node:path";
import {
  type DocumentKind,
  LATEST_VERSION_BY_KIND,
  VersionError,
  detectDocumentVersion,
  parseManagedIndex,
  parseManifest,
  parseManifestLock,
  parseProviderOverride,
  providerIdSchema,
} from "@madebywild/agent-harness-manifest";
import type { HarnessPaths } from "../paths.js";
import { collectSourceCandidates } from "../repository.js";
import type { Diagnostic, DoctorResult, ProviderId, VersionDiagnostic, VersionStatus } from "../types.js";
import { readTextIfExists } from "../utils.js";

const OVERRIDE_PROVIDER_PATTERN = /(?:\.overrides\.|OVERRIDES\.)(codex|claude|copilot)\.ya?ml$/u;

export async function runDoctor(paths: HarnessPaths): Promise<DoctorResult> {
  const files: VersionDiagnostic[] = [];

  const manifestStatus = await inspectJsonDocument(paths, {
    kind: "manifest",
    relativePath: ".harness/manifest.json",
    required: true,
    parseCurrent: parseManifest,
    invalidCode: "MANIFEST_INVALID",
  });
  if (manifestStatus) {
    files.push(manifestStatus);
  }

  const lockStatus = await inspectJsonDocument(paths, {
    kind: "lock",
    relativePath: ".harness/manifest.lock.json",
    required: false,
    parseCurrent: parseManifestLock,
    invalidCode: "LOCK_INVALID",
  });
  if (lockStatus) {
    files.push(lockStatus);
  }

  const managedIndexStatus = await inspectJsonDocument(paths, {
    kind: "managed-index",
    relativePath: ".harness/managed-index.json",
    required: false,
    parseCurrent: parseManagedIndex,
    invalidCode: "MANAGED_INDEX_INVALID",
  });
  if (managedIndexStatus) {
    files.push(managedIndexStatus);
  }

  const sourceCandidates = await collectSourceCandidates(paths);
  const overrideCandidates = sourceCandidates.filter((candidate) => OVERRIDE_PROVIDER_PATTERN.test(candidate));

  for (const overridePath of overrideCandidates) {
    const provider = parseProviderFromOverridePath(overridePath);
    const absolute = path.join(paths.root, overridePath);
    const text = await readTextIfExists(absolute);

    if (text === null) {
      continue;
    }

    try {
      const YAML = await import("yaml");
      const parsed = YAML.parse(text) as unknown;
      files.push(
        inspectParsedVersionedObject("provider-override", overridePath, parsed, parseProviderOverride, provider),
      );
    } catch (error) {
      files.push({
        code: "OVERRIDE_INVALID",
        severity: "error",
        message: error instanceof Error ? error.message : "Invalid override YAML",
        path: overridePath,
        provider,
        kind: "provider-override",
        status: "invalid",
        latestVersion: LATEST_VERSION_BY_KIND["provider-override"],
        canMigrate: false,
        hint: "Fix override YAML/schema issues before running 'harness migrate'.",
      });
    }
  }

  const diagnostics: Diagnostic[] = files
    .filter((status) => status.status !== "current")
    .map((status) => ({
      code: status.code,
      severity: status.severity,
      message: status.message,
      hint: status.hint,
      path: status.path,
      provider: status.provider,
    }));

  const migrationNeeded = files.some((status) => status.status === "outdated");
  const hasBlockingState = files.some((status) => ["unsupported", "invalid", "missing"].includes(status.status));

  if (migrationNeeded && files.some((status) => status.status === "current")) {
    diagnostics.push({
      code: "MIGRATION_INCOMPLETE",
      severity: "error",
      message: "Workspace contains mixed schema versions. Rerun 'harness migrate' to converge to latest schema.",
      path: ".harness",
      hint: "Run 'harness migrate' again. If it fails, inspect diagnostics and fix blocking files first.",
    });
  }

  return {
    healthy: files.length > 0 && diagnostics.length === 0,
    migrationNeeded,
    migrationPossible: !hasBlockingState,
    files,
    diagnostics,
  };
}

export function hasVersionBlockers(doctor: DoctorResult): boolean {
  return doctor.files.some((status) => status.status !== "current");
}

export function buildVersionPreflightDiagnostics(doctor: DoctorResult): Diagnostic[] {
  return doctor.diagnostics.length > 0
    ? doctor.diagnostics
    : [
        {
          code: "WORKSPACE_VERSION_BLOCKED",
          severity: "error",
          message: "Workspace schema version is not compatible with this CLI runtime.",
          hint: "Run 'harness doctor' then 'harness migrate'.",
          path: ".harness",
        },
      ];
}

interface InspectJsonDocumentInput {
  kind: Exclude<DocumentKind, "provider-override">;
  relativePath: string;
  required: boolean;
  invalidCode: string;
  parseCurrent(input: unknown): unknown;
}

async function inspectJsonDocument(
  paths: HarnessPaths,
  input: InspectJsonDocumentInput,
): Promise<VersionDiagnostic | null> {
  const absolute = path.join(paths.root, input.relativePath);
  const text = await readTextIfExists(absolute);

  if (text === null) {
    if (!input.required) {
      return null;
    }

    const isDefaultManifest = input.kind === "manifest" && input.relativePath === ".harness/manifest.json";

    return {
      code: isDefaultManifest ? "MANIFEST_NOT_FOUND" : "DOCUMENT_NOT_FOUND",
      severity: "error",
      message: isDefaultManifest
        ? "Missing manifest file at .harness/manifest.json"
        : `Missing required ${input.kind} file at ${input.relativePath}`,
      path: input.relativePath,
      hint: isDefaultManifest ? "Run 'harness init' first." : undefined,
      kind: input.kind,
      status: "missing",
      latestVersion: LATEST_VERSION_BY_KIND[input.kind],
      canMigrate: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      code: input.invalidCode,
      severity: "error",
      message: error instanceof Error ? error.message : "Invalid JSON",
      path: input.relativePath,
      kind: input.kind,
      status: "invalid",
      latestVersion: LATEST_VERSION_BY_KIND[input.kind],
      canMigrate: false,
      hint: "Fix schema/JSON issues before running 'harness migrate'.",
    };
  }

  return inspectParsedVersionedObject(input.kind, input.relativePath, parsed, input.parseCurrent);
}

function inspectParsedVersionedObject(
  kind: DocumentKind,
  pathValue: string,
  parsed: unknown,
  parseCurrent: (input: unknown) => unknown,
  provider?: ProviderId,
): VersionDiagnostic {
  const detection = detectDocumentVersion(kind, parsed);

  if (detection.status === "missing") {
    return createVersionStatus(kind, pathValue, {
      status: "missing",
      code: versionCode(kind, "MISSING"),
      message: "Missing required numeric 'version' field",
      provider,
      canMigrate: false,
      hint: "Add a valid numeric 'version' field and rerun 'harness doctor'.",
    });
  }

  if (detection.status === "invalid_type") {
    return createVersionStatus(kind, pathValue, {
      status: "invalid",
      code: versionCode(kind, "INVALID"),
      message: "Version field must be an integer",
      provider,
      canMigrate: false,
      hint: "Set 'version' to an integer value before running 'harness migrate'.",
    });
  }

  const version = detection.version as number;
  if (version < detection.latestVersion) {
    return createVersionStatus(kind, pathValue, {
      status: "outdated",
      version,
      code: versionCode(kind, "OUTDATED"),
      message: `Detected version ${version}; latest supported version is ${detection.latestVersion}`,
      provider,
      canMigrate: true,
      hint: "Run 'harness migrate' to upgrade this file.",
    });
  }

  if (version > detection.latestVersion) {
    return createVersionStatus(kind, pathValue, {
      status: "unsupported",
      version,
      code: versionCode(kind, "NEWER_THAN_CLI"),
      message: `Detected version ${version}, which is newer than this CLI supports (${detection.latestVersion})`,
      provider,
      canMigrate: false,
      hint: "Install a newer harness CLI for this workspace.",
    });
  }

  try {
    parseCurrent(parsed);
    return createVersionStatus(kind, pathValue, {
      status: "current",
      version,
      code: versionCode(kind, "CURRENT"),
      message: `Version ${version} is current`,
      provider,
      canMigrate: true,
    });
  } catch (error) {
    if (error instanceof VersionError) {
      return createVersionStatus(kind, pathValue, {
        status: statusFromVersionError(error),
        code: versionCode(kind, codeFromVersionError(error)),
        message: error.message,
        provider,
        canMigrate: false,
        hint: "Resolve version issues before running migration.",
      });
    }

    return createVersionStatus(kind, pathValue, {
      status: "invalid",
      version,
      code: kind === "manifest" ? "MANIFEST_INVALID" : kind === "lock" ? "LOCK_INVALID" : "MANAGED_INDEX_INVALID",
      message: error instanceof Error ? error.message : "Invalid schema",
      provider,
      canMigrate: false,
      hint: "Fix schema validation issues before running migration.",
    });
  }
}

function createVersionStatus(
  kind: DocumentKind,
  pathValue: string,
  input: {
    status: VersionStatus;
    code: string;
    message: string;
    provider?: ProviderId;
    canMigrate: boolean;
    version?: number;
    hint?: string;
  },
): VersionDiagnostic {
  return {
    code: input.code,
    severity: input.status === "current" ? "info" : "error",
    message: input.message,
    path: pathValue,
    provider: input.provider,
    kind,
    status: input.status,
    version: input.version,
    latestVersion: LATEST_VERSION_BY_KIND[kind],
    canMigrate: input.canMigrate,
    hint: input.hint,
  };
}

function versionCode(kind: DocumentKind, suffix: string): string {
  if (kind === "provider-override") {
    return `OVERRIDE_VERSION_${suffix}`;
  }

  return `${kind.toUpperCase().replaceAll("-", "_")}_VERSION_${suffix}`;
}

function parseProviderFromOverridePath(pathValue: string): ProviderId | undefined {
  const match = pathValue.match(OVERRIDE_PROVIDER_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = providerIdSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : undefined;
}

function statusFromVersionError(error: VersionError): VersionStatus {
  switch (error.reason) {
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

function codeFromVersionError(error: VersionError): "OUTDATED" | "NEWER_THAN_CLI" | "MISSING" | "INVALID" {
  switch (error.reason) {
    case "outdated_version":
      return "OUTDATED";
    case "unsupported_version":
      return "NEWER_THAN_CLI";
    case "missing_version":
      return "MISSING";
    case "invalid_version_type":
      return "INVALID";
  }
}
