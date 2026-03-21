# `packages/toolkit/src/engine.ts` + `engine/`

## Purpose

Implements orchestration (`HarnessEngine`) for init, entity CRUD, version preflight, planning, applying, and watch mode.

Supporting logic is split across submodules in `engine/`:

- `engine/entities.ts`
  - entity CRUD:
    - `addPromptEntity`
    - `addSkillEntity`
    - `addMcpEntity`
    - `addSubagentEntity`
    - `addHookEntity`
    - `addSettingsEntity`
  - registry pull/remove helpers:
    - `pullRegistryEntities`
    - `removeEntity`
  - source materialization/sha helpers:
    - `materializeFetchedEntity`
    - `ensureOverrideFiles`
    - `readCurrentSourceSha`
    - `loadSkillSourceHashes`
- `engine/state.ts`
  - manifest/lock/index helpers:
    - `readManifestOrThrow`
    - `readLockOrDefault`
    - `readManagedIndexOrDefault`
    - `setLockEntityRecord`
    - `upsertLockEntityRecord`
    - `removeLockEntityRecord`
    - `writeManagedSourceIndex`
- `engine/utils.ts`
  - pure helpers:
    - sort/validate/resolve helpers
    - `printDiagnostics`
    - `printApplySummary`
    - config/schema validator loaders

## Main class

- `HarnessEngine(cwd = process.cwd())`
- `init({ force? })`: creates or force-recreates `.harness` state files and source directories.
- `enableProvider` / `disableProvider`: mutate `manifest.providers.enabled`.
- entity add methods:
  - `addPrompt`
  - `addSkill`
  - `addMcp`
  - `addSubagent`
  - `addHook`
  - `addSettings`
- registry methods:
  - `listRegistries`
  - `addRegistry`
  - `removeRegistry`
  - `setDefaultRegistry`
  - `getDefaultRegistry`
  - `pullRegistry({ entityType?, id?, registry?, force? })`
- `remove(entityType, id, deleteSource)`: removes entity and optionally source/override files.
- `validate()`, `plan()`, `apply()`, `watch(debounceMs)`, `doctor({ json? })`, `migrate({ ... })`.

## Watch mode

`watch` monitors entity sources, overrides, manifest, and env files (`.harness/.env`, `.env.harness`). Changes to env files trigger re-apply alongside source file changes.

## Runtime guarantees

- Version preflight runs before normal runtime/mutating commands.
- Apply short-circuits when any `error` diagnostic exists.
- Lock/index are updated only when semantic payload changed.

## Settings pull hash policy

When pulling `settings` entities from a registry, lock records intentionally keep two hashes:

- `importedSourceSha256`: canonical payload hash from the registry fetch (used for pull conflict checks).
- `sourceSha256`: hash of the provider-serialized source file that was materialized locally (used for lock parity with loader/planner).

This split prevents no-op `apply` lock churn for `codex` settings, where canonical payload hashing and TOML file hashing are not byte-identical.
