import type {
  AgentsManifest,
  DocumentKind,
  EntityRef,
  EntityType,
  ManagedIndex,
  ManifestLock,
  ProviderId,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  RegistryManifest,
} from "@madebywild/agent-harness-manifest";

export type {
  AgentsManifest,
  EntityRef,
  EntityType,
  ManifestLock,
  ManagedIndex,
  ProviderId,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  RegistryManifest,
};

export const CLI_ENTITY_TYPES = ["prompt", "skill", "mcp", "subagent"] as const;
export type CliEntityType = (typeof CLI_ENTITY_TYPES)[number];

export const CLI_ENTITY_TO_MANIFEST_ENTITY: Record<CliEntityType, EntityType> = {
  prompt: "prompt",
  skill: "skill",
  mcp: "mcp_config",
  subagent: "subagent",
};

export function isCliEntityType(value: string): value is CliEntityType {
  return (CLI_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface CanonicalPrompt {
  id: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface CanonicalSkill {
  id: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface CanonicalMcpConfig {
  id: string;
  json: Record<string, unknown>;
}

export interface CanonicalSubagent {
  id: string;
  name: string;
  description: string;
  body: string;
  metadata: Record<string, unknown>;
}

export interface RenderedArtifact {
  path: string;
  content: string;
  ownerEntityId: string;
  provider: ProviderId;
  format: "markdown" | "json" | "toml";
}

export interface ProviderStateInput {
  mcps: CanonicalMcpConfig[];
  mcpOverrideByEntity?: Map<string, ProviderOverride | undefined>;
  subagents: CanonicalSubagent[];
  subagentOverrideByEntity?: Map<string, ProviderOverride | undefined>;
}

export interface ProviderAdapter {
  id: ProviderId;
  renderPrompt?(input: CanonicalPrompt, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderSkill?(input: CanonicalSkill, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderMcp?(
    input: CanonicalMcpConfig[],
    overrideByEntity?: Map<string, ProviderOverride | undefined>,
  ): Promise<RenderedArtifact[]>;
  renderSubagent?(input: CanonicalSubagent, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderProviderState?(input: ProviderStateInput): Promise<RenderedArtifact[]>;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  hint?: string;
  path?: string;
  entityId?: string;
  provider?: ProviderId;
}

export type VersionStatus = "current" | "outdated" | "unsupported" | "invalid" | "missing";

export interface VersionDiagnostic extends Diagnostic {
  kind: DocumentKind;
  status: VersionStatus;
  version?: number;
  latestVersion: number;
  canMigrate: boolean;
}

export interface DoctorResult {
  healthy: boolean;
  migrationNeeded: boolean;
  migrationPossible: boolean;
  files: VersionDiagnostic[];
  diagnostics: Diagnostic[];
}

export interface MigrationAction {
  kind: DocumentKind | "backup";
  path: string;
  action: "noop" | "migrate" | "rewrite" | "backup" | "skip";
  details: string;
}

export interface MigrationResult {
  success: boolean;
  dryRun: boolean;
  backupRoot?: string;
  actions: MigrationAction[];
  diagnostics: Diagnostic[];
}

export type OperationType = "create" | "update" | "delete" | "noop";

export interface Operation {
  type: OperationType;
  path: string;
  provider?: ProviderId;
  reason: string;
}

export interface PlanOptions {
  cwd?: string;
}

export interface ApplyOptions extends PlanOptions {
  json?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface PlanResult {
  operations: Operation[];
  diagnostics: Diagnostic[];
  nextLock: ManifestLock;
}

export interface ApplyResult extends PlanResult {
  writtenArtifacts: string[];
  prunedArtifacts: string[];
}

export interface RemoveResult {
  entityType: CliEntityType;
  id: string;
}

export type LockEntityRecord = ManifestLock["entities"][number];
export type RegistryRevision = NonNullable<LockEntityRecord["registryRevision"]>;

export interface RegistryListEntry {
  id: RegistryId;
  definition: RegistryDefinition;
  isDefault: boolean;
}

export interface RegistryPullResult {
  updatedEntities: Array<{ type: CliEntityType; id: string }>;
}

export interface RegistryValidationOptions {
  repoPath?: string;
  rootPath?: string;
}

export interface RegistryValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface LoadedPrompt {
  entity: EntityRef;
  canonical: CanonicalPrompt;
  sourceSha256: string;
  overrideByProvider: Map<ProviderId, ProviderOverride | undefined>;
  overrideShaByProvider: Partial<Record<ProviderId, string>>;
}

export interface LoadedSkillFile {
  path: string;
  sha256: string;
  content: string;
}

export interface LoadedSkill {
  entity: EntityRef;
  canonical: CanonicalSkill;
  filesWithContent: LoadedSkillFile[];
  sourceSha256: string;
  overrideByProvider: Map<ProviderId, ProviderOverride | undefined>;
  overrideShaByProvider: Partial<Record<ProviderId, string>>;
}

export interface LoadedMcp {
  entity: EntityRef;
  canonical: CanonicalMcpConfig;
  sourceSha256: string;
  overrideByProvider: Map<ProviderId, ProviderOverride | undefined>;
  overrideShaByProvider: Partial<Record<ProviderId, string>>;
}

export interface LoadedSubagent {
  entity: EntityRef;
  canonical: CanonicalSubagent;
  sourceSha256: string;
  overrideByProvider: Map<ProviderId, ProviderOverride | undefined>;
  overrideShaByProvider: Partial<Record<ProviderId, string>>;
}

export interface InternalPlanResult extends PlanResult {
  artifactsByPath: Map<string, { content: string; provider: ProviderId; ownerEntityIds: string[] }>;
  nextManagedIndex: ManagedIndex;
}

export interface LoadResult {
  manifest: AgentsManifest;
  diagnostics: Diagnostic[];
  prompt?: LoadedPrompt;
  skills: LoadedSkill[];
  mcps: LoadedMcp[];
  subagents: LoadedSubagent[];
}
