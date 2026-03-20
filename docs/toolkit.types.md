# `packages/toolkit/src/types.ts`

## Purpose

Defines shared toolkit interfaces for canonical entities, provider adapters, diagnostics, plan/apply operations, and internal planning state.

## Main groups

- Schema-backed aliases:
  - `AgentsManifest`, `EntityRef`, `EntityType`, `ManifestLock`, `ManagedIndex`, `ProviderId`, `ProviderOverride`
- Canonical models:
  - `CanonicalPrompt`, `CanonicalSkill`, `CanonicalMcpConfig`, `CanonicalSubagent`, `CanonicalHook`
  - Hook enums/unions: `CanonicalHookMode`, `CanonicalHookEvent`, `CanonicalHookHandler`
- Rendering contracts:
  - `RenderedArtifact`, `ProviderAdapter`, `ProviderStateInput`
- Diagnostics/operations:
  - `Diagnostic`, `DiagnosticSeverity`, `Operation`, `OperationType`
- Command result models:
  - `ValidationResult`, `PlanResult`, `ApplyResult`, `DoctorResult`, `MigrationResult`
- Versioning models:
  - `VersionStatus`, `VersionDiagnostic`, `MigrationAction`
- Loader/planner internal models:
  - `LoadedPrompt`, `LoadedSkillFile`, `LoadedSkill`, `LoadedMcp`, `LoadedSubagent`, `LoadedHook`, `LoadResult`, `InternalPlanResult`

## Notes

- `ProviderAdapter.renderMcp` accepts all canonical MCP configs and optional per-entity override map.
- `ProviderAdapter.renderSubagent` renders provider-native subagent artifacts for providers with per-subagent files.
- `ProviderAdapter.renderHooks` renders provider-native hook artifacts for providers with dedicated hook outputs.
- `ProviderAdapter.renderProviderState` supports composite provider artifacts (Codex merges MCP, subagents, and hook notify state).
- `ProviderStateInput` includes MCP/subagent/hook arrays and per-entity override maps.
- CLI entity types now include `hook`.
