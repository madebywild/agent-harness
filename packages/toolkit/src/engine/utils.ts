import fs from "node:fs/promises";
import path from "node:path";
import {
  agentsManifestSchema,
  DEFAULT_REGISTRY_ID,
  managedIndexSchema,
  manifestLockSchema,
} from "@madebywild/agent-harness-manifest";
import type {
  AgentsManifest,
  CliEntityType,
  Diagnostic,
  EntityType,
  ManagedIndex,
  ManifestLock,
  ProviderOverride,
  RegistryDefinition,
  RegistryId,
  ValidationResult,
} from "../types.js";
import { sha256, stableStringify } from "../utils.js";

export function sortEntities(entities: AgentsManifest["entities"]): AgentsManifest["entities"] {
  const order: Record<EntityType, number> = {
    prompt: 0,
    skill: 1,
    mcp_config: 2,
    subagent: 3,
    hook: 4,
    command: 5,
  };

  return [...entities].sort((left, right) => {
    const typeOrder = order[left.type] - order[right.type];
    if (typeOrder !== 0) {
      return typeOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

export function validateEntityId(id: string, type: EntityType): void {
  if (!/^[a-zA-Z0-9._-]+$/u.test(id)) {
    throw new Error(`Invalid ${type} id '${id}'. Allowed characters: letters, digits, '.', '_', '-'`);
  }
}

export function validateRegistryId(id: string): void {
  if (!/^[a-zA-Z0-9._-]+$/u.test(id)) {
    throw new Error(`Invalid registry id '${id}'. Allowed characters: letters, digits, '.', '_', '-'`);
  }
}

export function registryIdFromInput(value: string): RegistryId {
  validateRegistryId(value);
  return value;
}

export function resolveEntityRegistrySelection(
  manifest: AgentsManifest,
  explicitRegistry?: string,
): { id: RegistryId; definition: RegistryDefinition } {
  const registryId = explicitRegistry
    ? registryIdFromInput(explicitRegistry)
    : manifest.registries.default || DEFAULT_REGISTRY_ID;
  const definition = manifest.registries.entries[registryId];
  if (!definition) {
    throw new Error(`REGISTRY_NOT_FOUND: registry '${registryId}' is not configured`);
  }
  return { id: registryId, definition };
}

export function manifestEntityTypeToCliEntityType(type: EntityType): CliEntityType {
  switch (type) {
    case "prompt":
      return "prompt";
    case "skill":
      return "skill";
    case "mcp_config":
      return "mcp";
    case "subagent":
      return "subagent";
    case "hook":
      return "hook";
    case "command":
      return "command";
  }
}

export function isSkillOverrideFile(relativePath: string): boolean {
  return /^OVERRIDES\.[^.]+\.ya?ml$/u.test(path.basename(relativePath));
}

export function computeSkillSourceSha(files: Array<{ path: string; sha256: string }>): string {
  const normalized = files
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableStringify(normalized));
}

export function resolveRemoveTargetId(entityType: CliEntityType, id: string): string {
  if (entityType !== "prompt") {
    return id;
  }

  if (id !== "system") {
    throw new Error(`Prompt entity id must be 'system', received '${id}'`);
  }

  return "system";
}

export function printDiagnostics(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return;
  }
  for (const diagnostic of diagnostics) {
    const suffix = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.error(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${suffix}`);
  }
}

export function printApplySummary(writtenArtifacts: string[], prunedArtifacts: string[]): void {
  if (writtenArtifacts.length > 0) {
    console.log(`[harness] wrote ${writtenArtifacts.length} artifact(s)`);
  }

  if (prunedArtifacts.length > 0) {
    console.log(`[harness] removed ${prunedArtifacts.length} stale artifact(s)`);
  }
}

export function preflightDiagnosticsFromDoctor(
  doctorDiagnostics: Diagnostic[],
  fileDiagnostics: Array<{ code: string }>,
): Diagnostic[] {
  if (doctorDiagnostics.length === 0) {
    return doctorDiagnostics;
  }

  const fileCodes = new Set(fileDiagnostics.map((status) => status.code));
  const filtered = doctorDiagnostics.filter((diagnostic) => fileCodes.has(diagnostic.code));
  return filtered.length > 0 ? filtered : doctorDiagnostics;
}

export function isMissingWorkspaceCode(code: string): boolean {
  return code === "MANIFEST_NOT_FOUND" || code === "WORKSPACE_NOT_INITIALIZED";
}

export async function loadConfig(pathValue?: string): Promise<AgentsManifest> {
  const configPath = pathValue ? path.resolve(pathValue) : path.resolve(process.cwd(), ".harness/manifest.json");
  const text = await fs.readFile(configPath, "utf8");
  return agentsManifestSchema.parse(JSON.parse(text));
}

export function validateConfig(config: AgentsManifest): ValidationResult {
  const result = agentsManifestSchema.safeParse(config);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "MANIFEST_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export function validateLock(lock: ManifestLock): ValidationResult {
  const result = manifestLockSchema.safeParse(lock);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "LOCK_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export function validateManagedIndex(index: ManagedIndex): ValidationResult {
  const result = managedIndexSchema.safeParse(index);
  if (result.success) {
    return { valid: true, diagnostics: [] };
  }

  return {
    valid: false,
    diagnostics: result.error.issues.map((issue) => ({
      code: "MANAGED_INDEX_INVALID",
      severity: "error",
      message: issue.message,
      path: issue.path.join("."),
    })),
  };
}

export async function loadOverride(pathValue: string): Promise<ProviderOverride> {
  const text = await fs.readFile(pathValue, "utf8");
  const YAML = await import("yaml");
  return (await import("@madebywild/agent-harness-manifest")).parseProviderOverride(YAML.parse(text));
}
