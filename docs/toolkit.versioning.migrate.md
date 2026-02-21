# `packages/toolkit/src/versioning/migrate.ts`

## Purpose

Executes explicit schema migration with safety rails (backup snapshot + atomic writes) and derived-state rebuild.

## Main API

- `runMigration(paths, { to?, dryRun? })`

## Behavior notes

- Rejects downgrade attempts (`MIGRATION_DOWNGRADE_UNSUPPORTED`) when files are newer than supported CLI schema.
- Blocks on invalid/missing version metadata before writes.
- Rebuilds lock and managed-index from desired rendered outputs.
- Uses deterministic write order: overrides, lock, managed-index, manifest (manifest last).
- Supports `dryRun` to report planned actions without touching disk.
