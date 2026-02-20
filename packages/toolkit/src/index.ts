import { HarnessEngine, loadConfig, validateConfig, validateLock } from "./engine.js";
import type { ApplyOptions, ApplyResult, PlanOptions, PlanResult } from "./types.js";

export { HarnessEngine, loadConfig, validateConfig, validateLock };

export type {
  AgentsManifest,
  ApplyResult,
  CanonicalMcpConfig,
  CanonicalPrompt,
  CanonicalSkill,
  Diagnostic,
  EntityRef,
  EntityType,
  ManifestLock,
  ManagedIndex,
  Operation,
  PlanResult,
  ProviderAdapter,
  ProviderId,
  ProviderOverride,
  RenderedArtifact,
  ValidationResult,
} from "./types.js";

export async function plan(opts: PlanOptions = {}): Promise<PlanResult> {
  return new HarnessEngine(opts.cwd).plan();
}

export async function apply(opts: ApplyOptions = {}): Promise<ApplyResult> {
  return new HarnessEngine(opts.cwd).apply();
}
