export const DOCUMENT_KINDS = ["manifest", "lock", "managed-index", "provider-override"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const LATEST_SCHEMA_MAJOR = 1;

export const LATEST_VERSION_BY_KIND: Record<DocumentKind, number> = {
  manifest: LATEST_SCHEMA_MAJOR,
  lock: LATEST_SCHEMA_MAJOR,
  "managed-index": LATEST_SCHEMA_MAJOR,
  "provider-override": LATEST_SCHEMA_MAJOR,
};

export type VersionDetectionStatus = "ok" | "missing" | "invalid_type";

export interface VersionDetectionResult {
  kind: DocumentKind;
  latestVersion: number;
  status: VersionDetectionStatus;
  version?: number;
}

export type VersionErrorReason =
  | "unsupported_version"
  | "outdated_version"
  | "missing_version"
  | "invalid_version_type";

export class VersionError extends Error {
  readonly kind: DocumentKind;
  readonly reason: VersionErrorReason;
  readonly latestVersion: number;
  readonly version?: number;

  constructor(input: {
    kind: DocumentKind;
    reason: VersionErrorReason;
    latestVersion: number;
    version?: number;
  }) {
    super(buildVersionErrorMessage(input));
    this.name = "VersionError";
    this.kind = input.kind;
    this.reason = input.reason;
    this.latestVersion = input.latestVersion;
    this.version = input.version;
  }
}

function buildVersionErrorMessage(input: {
  kind: DocumentKind;
  reason: VersionErrorReason;
  latestVersion: number;
  version?: number;
}): string {
  const kindLabel = formatKind(input.kind);
  switch (input.reason) {
    case "missing_version":
      return `${kindLabel} is missing required numeric 'version'`;
    case "invalid_version_type":
      return `${kindLabel} has non-numeric 'version'`;
    case "outdated_version":
      return `${kindLabel} version ${String(input.version)} is older than supported version ${input.latestVersion}`;
    case "unsupported_version":
      return `${kindLabel} version ${String(input.version)} is newer than supported version ${input.latestVersion}`;
  }
}

function formatKind(kind: DocumentKind): string {
  switch (kind) {
    case "manifest":
      return "Manifest";
    case "lock":
      return "Manifest lock";
    case "managed-index":
      return "Managed index";
    case "provider-override":
      return "Provider override";
  }
}

export function detectDocumentVersion(kind: DocumentKind, input: unknown): VersionDetectionResult {
  const latestVersion = LATEST_VERSION_BY_KIND[kind];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      kind,
      latestVersion,
      status: "missing",
    };
  }

  const candidate = (input as Record<string, unknown>).version;

  if (typeof candidate === "undefined") {
    return {
      kind,
      latestVersion,
      status: "missing",
    };
  }

  if (typeof candidate !== "number" || !Number.isInteger(candidate)) {
    return {
      kind,
      latestVersion,
      status: "invalid_type",
    };
  }

  return {
    kind,
    latestVersion,
    status: "ok",
    version: candidate,
  };
}

export function isLatestVersion(kind: DocumentKind, version: number): boolean {
  return LATEST_VERSION_BY_KIND[kind] === version;
}

export function assertLatestVersion(kind: DocumentKind, input: unknown): number {
  const detected = detectDocumentVersion(kind, input);

  if (detected.status === "missing") {
    throw new VersionError({
      kind,
      reason: "missing_version",
      latestVersion: detected.latestVersion,
    });
  }

  if (detected.status === "invalid_type") {
    throw new VersionError({
      kind,
      reason: "invalid_version_type",
      latestVersion: detected.latestVersion,
    });
  }

  const version = detected.version as number;

  if (version < detected.latestVersion) {
    throw new VersionError({
      kind,
      reason: "outdated_version",
      latestVersion: detected.latestVersion,
      version,
    });
  }

  if (version > detected.latestVersion) {
    throw new VersionError({
      kind,
      reason: "unsupported_version",
      latestVersion: detected.latestVersion,
      version,
    });
  }

  return version;
}
