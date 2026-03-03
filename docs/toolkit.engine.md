# `packages/toolkit/src/engine.ts` + `engine/`

## Purpose

Implements the orchestration layer (`HarnessEngine`) for init, CRUD, version preflight/diagnostics/migration, planning, applying, and watch mode. Supporting logic is split across three sub-modules in `engine/`:

- **`engine/entities.ts`** — entity CRUD: `addPromptEntity`, `addSkillEntity`, `addMcpEntity`, `addSubagentEntity`, `pullRegistryEntities`, `removeEntity`, `materializeFetchedEntity`, `ensureOverrideFiles`, `readCurrentSourceSha`, `loadSkillSourceHashes`.
- **`engine/state.ts`** — manifest/lock state helpers: `readManifestOrThrow`, `readLockOrDefault`, `readManagedIndexOrDefault`, `setLockEntityRecord`, `upsertLockEntityRecord`, `removeLockEntityRecord`, `writeManagedSourceIndex`.
- **`engine/utils.ts`** — pure utilities and validators: sort/validate/resolve helpers, `printDiagnostics`, `printApplySummary`, `preflightDiagnosticsFromDoctor`, `loadConfig`, `validateConfig`, `validateLock`, `validateManagedIndex`, `loadOverride`.

## Main class

- `HarnessEngine(cwd = process.cwd())`
- `init({ force? })`: creates or force-recreates `.harness` state files.
- `enableProvider` / `disableProvider`: mutate `manifest.providers.enabled`.
- `addPrompt`, `addSkill`, `addMcp`, `addSubagent`: scaffold/import sources + override sidecars and register manifest entries.
  - Accept optional `{ registry?: string }`.
  - For git registries, fetches remote entity content and materializes into local `.harness/src`.
  - Writes lock provenance immediately (registry + imported digest + git revision).
- `listRegistries`, `addRegistry`, `removeRegistry`, `setDefaultRegistry`, `getDefaultRegistry`: manage manifest registry configuration.
- `pullRegistry({ entityType?, id?, registry?, force? })`: refresh imported entities from git registries with local-drift protection (`--force` equivalent).
- `remove(entityType, id, deleteSource)`: removes manifest entry and optionally deletes source and overrides; returns removed `{ entityType, id }`.
  - Prompt removals require `id === "system"` (v1 prompt singleton).
- `validate()`: returns diagnostics-only validity decision.
- `plan()`: returns operations + diagnostics + next lock.
- `apply()`: executes create/update/delete operations and writes lock/index.
- `watch(debounceMs)`: monitors `.harness` source files and re-runs apply in a debounced single-flight loop.
- `doctor({ json? })`: returns workspace schema version status + blockers.
- `migrate({ to?: \"latest\", dryRun?, json? })`: executes explicit schema migration workflow.

## Validation/planning internals

- `planInternal()` composes repository loaders, canonical loader, and planner.
- Version preflight runs before normal runtime/mutating commands and blocks non-current schema states with actionable diagnostics.
- Preflight checks workspace presence first and reports `WORKSPACE_NOT_INITIALIZED` with `harness init` guidance when `.harness` is missing.
- If manifest is missing, planning returns empty operations and carries manifest diagnostics.
- Apply short-circuits when any `error` diagnostic exists.

## Exported utilities (from `engine/utils.ts`)

- `loadConfig(path?)`: read+parse manifest from disk.
- `validateConfig`, `validateLock`, `validateManagedIndex`: schema-based validators returning diagnostics.
- `loadOverride(path)`: parse provider override YAML via shared schema.
