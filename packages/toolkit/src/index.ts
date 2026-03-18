import { runCliArgv, runCliCommand } from "./cli/main.js";
import { loadConfig, validateConfig, validateLock } from "./engine/utils.js";
import { HarnessEngine } from "./engine.js";
import { validateRegistryRepo } from "./registry-validator.js";
import type { ApplyOptions, ApplyResult, DoctorResult, MigrationResult, PlanOptions, PlanResult } from "./types.js";

export type {
  CliEnvelope,
  CliExecutionContext,
  CliResolvedContext,
  CommandId,
  CommandInput,
  CommandOutput,
} from "./cli/contracts.js";
export type {
  AgentsManifest,
  ApplyResult,
  CanonicalMcpConfig,
  CanonicalPrompt,
  CanonicalSkill,
  CanonicalSubagent,
  Diagnostic,
  DoctorResult,
  EntityRef,
  EntityType,
  ManagedIndex,
  ManifestLock,
  MigrationAction,
  MigrationResult,
  Operation,
  PlanResult,
  ProviderAdapter,
  ProviderId,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  RegistryListEntry,
  RegistryManifest,
  RegistryPullResult,
  RegistryValidationOptions,
  RegistryValidationResult,
  RenderedArtifact,
  ValidationResult,
  VersionDiagnostic,
} from "./types.js";
export { HarnessEngine, loadConfig, runCliArgv, runCliCommand, validateConfig, validateLock, validateRegistryRepo };

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
