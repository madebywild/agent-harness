# `packages/toolkit/src/types.ts`

## Purpose

Defines shared toolkit interfaces for canonical entities, provider adapters, diagnostics, plan/apply operations, and internal planning state.

## Main groups

- Schema-backed aliases:
  - `AgentsManifest`, `EntityRef`, `EntityType`, `ManifestLock`, `ManagedIndex`, `ProviderId`, `ProviderOverride`
- Canonical models:
  - `CanonicalPrompt`, `CanonicalSkill`, `CanonicalMcpConfig`
- Rendering contracts:
  - `RenderedArtifact`, `ProviderAdapter`
- Diagnostics/operations:
  - `Diagnostic`, `DiagnosticSeverity`, `Operation`, `OperationType`
- Command result models:
  - `ValidationResult`, `PlanResult`, `ApplyResult`, `DoctorResult`, `MigrationResult`
- Versioning models:
  - `VersionStatus`, `VersionDiagnostic`, `MigrationAction`
- Loader/planner internal models:
  - `LoadedPrompt`, `LoadedSkillFile`, `LoadedSkill`, `LoadedMcp`, `LoadResult`, `InternalPlanResult`

## Notes

- `ProviderAdapter.renderMcp` accepts all canonical MCP configs and optional per-entity override map.
- `InternalPlanResult` extends `PlanResult` with planned artifact content map and next managed index payload.
