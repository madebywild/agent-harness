import type {
  AgentsManifest,
  EntityRef,
  EntityType,
  ManifestLock,
  ManagedIndex,
  ProviderId,
  ProviderOverride
} from "@agent-harness/manifest-schema";

export type { AgentsManifest, EntityRef, EntityType, ManifestLock, ManagedIndex, ProviderId, ProviderOverride };

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

export interface RenderedArtifact {
  path: string;
  content: string;
  ownerEntityId: string;
  provider: ProviderId;
  format: "markdown" | "json" | "toml";
}

export interface ProviderAdapter {
  id: ProviderId;
  renderPrompt?(input: CanonicalPrompt, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderSkill?(input: CanonicalSkill, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderMcp?(
    input: CanonicalMcpConfig[],
    overrideByEntity?: Map<string, ProviderOverride | undefined>
  ): Promise<RenderedArtifact[]>;
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
}
