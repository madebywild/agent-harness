# `packages/toolkit/src/engine.ts`

## Purpose

Implements the orchestration layer (`HarnessEngine`) for init, CRUD, version preflight/diagnostics/migration, planning, applying, and watch mode.

## Main class

- `HarnessEngine(cwd = process.cwd())`
- `init({ force? })`: creates or force-recreates `.harness` state files.
- `enableProvider` / `disableProvider`: mutate `manifest.providers.enabled`.
- `addPrompt`, `addSkill`, `addMcp`: scaffold source + override sidecars and register manifest entries.
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
- If manifest is missing, planning returns empty operations and carries manifest diagnostics.
- Apply short-circuits when any `error` diagnostic exists.

## Exported utilities

- `loadConfig(path?)`: read+parse manifest from disk.
- `validateConfig`, `validateLock`, `validateManagedIndex`: schema-based validators returning diagnostics.
- `loadOverride(path)`: parse provider override YAML via shared schema.
