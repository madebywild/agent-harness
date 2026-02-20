# Versioning Policy Addendum (Forward-Compat, Atomicity, Post-Migration Derived State)

## Summary
Lock three decisions now:
1. Older CLIs never mutate newer workspaces.
2. No cross-file transaction; migration is idempotent with explicit safeguards.
3. Lock/index rebuild after migration uses deterministic “adopt desired outputs” logic to avoid unmanaged-collision deadlocks.

## 1) Forward-Compatibility Story (Newer Workspace on Older CLI)

### Runtime policy
1. Every command first performs lightweight version detection (before strict schema parse) on:
   - `.harness/manifest.json`
   - `.harness/manifest.lock.json`
   - `.harness/managed-index.json`
   - discovered override sidecars
2. If any file has `version > CLI_SUPPORTED_VERSION[kind]`, return hard error diagnostics:
   - `MANIFEST_VERSION_NEWER_THAN_CLI`
   - `LOCK_VERSION_NEWER_THAN_CLI`
   - `MANAGED_INDEX_VERSION_NEWER_THAN_CLI`
   - `OVERRIDE_VERSION_NEWER_THAN_CLI`
3. Commands `plan/apply/validate/watch/init/add/remove/provider *` must exit non-zero and perform no writes.
4. `doctor` still runs and prints exact blockers plus “upgrade CLI” instruction.
5. `migrate` on older CLI does not downgrade newer workspaces; it exits with `MIGRATION_DOWNGRADE_UNSUPPORTED`.

### User impact contract
1. Old CLI is safe (no accidental corruption).
2. Recovery path is always “install newer CLI, run `harness doctor`, then `harness migrate` if needed.”

## 2) Multi-File Atomicity Decision

### Explicit decision
1. Do not implement global multi-file atomic transactions.
2. Accept the gap and make migration resumable/idempotent.

### Safeguards
1. Pre-write backup snapshot: `.harness/.backup/<timestamp>/...`.
2. Per-file atomic writes (temp file + rename).
3. Deterministic write order:
   - migrate non-authoritative files first (overrides, lock, index),
   - write `manifest.json` last.
4. `migrate` recomputes from current on-disk state each run; rerun always converges.
5. `doctor` reports mixed-version state as `MIGRATION_INCOMPLETE` with instruction to rerun `harness migrate`.

## 3) Post-Migration Lock/Index Workflow and Collision Handling

### Decision for lock/index when reset/rebuild is required
1. Do not reset lock/index to empty.
2. Rebuild derived state immediately during migration:
   - compute desired artifacts from migrated manifest + source files,
   - write fresh lock from desired artifact hashes,
   - write managed-index with:
     - `managedSourcePaths` from manifest registration,
     - `managedOutputPaths` = full desired output path set.
3. This is an explicit one-time adoption of desired output paths, preventing `OUTPUT_COLLISION_UNMANAGED` on first post-migration `apply`.

### Collision semantics after migration
1. Desired-path files are considered managed after migration and may be updated by `apply`.
2. Files outside desired output paths remain unmanaged and untouched.
3. If desired set cannot be computed (render/validation errors), migration aborts before final manifest write and reports blocking diagnostics.

### Post-migration operator workflow
1. Run `harness migrate`.
2. Run `harness doctor` and verify no version blockers.
3. Run `harness apply`.
4. If `apply` reports non-version diagnostics, resolve content/config issues and rerun.

## Test additions
1. Older-CLI simulation rejects newer manifest with no writes.
2. Mixed-version workspace is flagged as `MIGRATION_INCOMPLETE`.
3. Interrupted migration rerun converges to same final files.
4. Rebuilt managed-index prevents first-apply unmanaged collisions.
5. `migrate --dry-run` reports would-adopt output paths without writes.

## Assumptions and defaults
1. Downgrade migrations are out of scope.
2. “Adopt desired outputs on migration rebuild” is intentional and documented.
3. Backup retention remains manual in this iteration.
