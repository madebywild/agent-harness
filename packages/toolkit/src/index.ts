import { runCliArgv, runCliCommand } from "./cli/main.js";
import { HarnessEngine } from "./engine.js";
import { loadConfig, validateConfig, validateLock } from "./engine/utils.js";
import { validateRegistryRepo } from "./registry-validator.js";
import type { ApplyOptions, ApplyResult, DoctorResult, MigrationResult, PlanOptions, PlanResult } from "./types.js";

export { HarnessEngine, loadConfig, validateConfig, validateLock };
export { validateRegistryRepo };
export { runCliArgv, runCliCommand };

export type {
  AgentsManifest,
  ApplyResult,
  CanonicalSubagent,
  CanonicalMcpConfig,
  CanonicalPrompt,
  CanonicalSkill,
  Diagnostic,
  DoctorResult,
  EntityRef,
  EntityType,
  ManifestLock,
  ManagedIndex,
  Operation,
  PlanResult,
  MigrationAction,
  MigrationResult,
  ProviderAdapter,
  ProviderId,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  RegistryListEntry,
  RegistryManifest,
  RegistryValidationOptions,
  RegistryValidationResult,
  RegistryPullResult,
  RenderedArtifact,
  ValidationResult,
  VersionDiagnostic,
} from "./types.js";

export type {
  CliEnvelope,
  CliExecutionContext,
  CliResolvedContext,
  CommandId,
  CommandInput,
  CommandOutput,
} from "./cli/contracts.js";

export async function plan(opts: PlanOptions = {}): Promise<PlanResult> {
  return new HarnessEngine(opts.cwd).plan();
}

export async function apply(opts: ApplyOptions = {}): Promise<ApplyResult> {
  return new HarnessEngine(opts.cwd).apply();
}

export async function doctor(opts: PlanOptions & { json?: boolean } = {}): Promise<DoctorResult> {
  return new HarnessEngine(opts.cwd).doctor({ json: opts.json });
}

export async function migrate(
  opts: PlanOptions & { to?: "latest"; dryRun?: boolean; json?: boolean } = {},
): Promise<MigrationResult> {
  return new HarnessEngine(opts.cwd).migrate({
    to: opts.to,
    dryRun: opts.dryRun,
    json: opts.json,
  });
}
