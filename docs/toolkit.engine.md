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
    - `addCommandEntity`
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
- `engine/presets.ts`
  - `applyResolvedPreset(cwd, preset)`: applies a resolved preset's ordered operations against the workspace.
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
- third-party skills integration:
  - `findSkills(query)` — runs discovery through pinned `skills@1.4.6`
  - `importSkill(...)` — imports single-skill snapshots with strict audit/payload gates and provenance sidecar writes
- registry methods:
  - `listRegistries`
  - `addRegistry`
  - `removeRegistry`
  - `setDefaultRegistry`
  - `getDefaultRegistry`
  - `pullRegistry({ entityType?, id?, registry?, force? })`
- preset methods:
  - `listPresets({ registry? })`: returns bundled + local presets by default, or registry presets when `registry` is specified.
  - `describePreset(presetId, { registry? })`: resolves a single preset with full definition and embedded content.
  - `applyPreset(presetId, { registry? })`: materializes a preset into the workspace (providers, entities, settings).
- `remove(entityType, id, deleteSource)`: removes entity and optionally source/override files.
- `validate()`, `plan()`, `apply()`, `watch(debounceMs)`, `doctor({ json? })`, `migrate({ ... })`.

## Watch mode

`watch` monitors entity sources, overrides, manifest, and env files (`.harness/.env`, `.env.harness`). Changes to env files trigger re-apply alongside source file changes.

## Runtime guarantees

- Version preflight runs before normal runtime/mutating commands.
- Apply short-circuits when any `error` diagnostic exists.
- Lock/index are updated only when semantic payload changed.
- `importSkill` blocks workspace mutation on failed audit/payload validation; successful imports write provenance metadata to `.harness/imports/skills/<id>.json`.

## Settings pull hash policy

When pulling `settings` entities from a registry, lock records intentionally keep two hashes:

- `importedSourceSha256`: canonical payload hash from the registry fetch (used for pull conflict checks).
- `sourceSha256`: hash of the provider-serialized source file that was materialized locally (used for lock parity with loader/planner).

This split prevents no-op `apply` lock churn for `codex` settings, where canonical payload hashing and TOML file hashing are not byte-identical.
