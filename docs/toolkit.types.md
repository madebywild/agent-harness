# `packages/toolkit/src/types.ts`

## Purpose

Defines shared toolkit interfaces for canonical entities, provider adapters, diagnostics, plan/apply operations, and internal planning state.

## Main groups

- Schema-backed aliases:
  - `AgentsManifest`, `EntityRef`, `EntityType`, `ManifestLock`, `ManagedIndex`, `ProviderId`, `ProviderOverride`
- Canonical models:
  - `CanonicalPrompt`, `CanonicalSkill`, `CanonicalMcpConfig`, `CanonicalSubagent`
- Rendering contracts:
  - `RenderedArtifact`, `ProviderAdapter`, `ProviderStateInput`
- Diagnostics/operations:
  - `Diagnostic`, `DiagnosticSeverity`, `Operation`, `OperationType`
- Command result models:
  - `ValidationResult`, `PlanResult`, `ApplyResult`, `DoctorResult`, `MigrationResult`
- Versioning models:
  - `VersionStatus`, `VersionDiagnostic`, `MigrationAction`
- Loader/planner internal models:
  - `LoadedPrompt`, `LoadedSkillFile`, `LoadedSkill`, `LoadedMcp`, `LoadedSubagent`, `LoadResult`, `InternalPlanResult`

## Notes

- `ProviderAdapter.renderMcp` accepts all canonical MCP configs and optional per-entity override map.
- `ProviderAdapter.renderSubagent` renders provider-native subagent artifacts for providers with per-subagent files.
- `ProviderAdapter.renderProviderState` supports composite provider artifacts (used by Codex to merge MCP + subagent state).
- `InternalPlanResult` extends `PlanResult` with planned artifact content map and next managed index payload.
