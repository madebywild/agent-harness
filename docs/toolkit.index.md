# `packages/toolkit/src/index.ts`

## Purpose

Public package entrypoint for programmatic use.
Published as `@madebywild/agent-harness-framework`.

## Re-exports

- `HarnessEngine`
- `loadConfig`, `validateConfig`, `validateLock`
- Core types from `types.ts` (manifest types, diagnostics, operations, adapter contracts, version diagnostics/migration result models, etc.)

## Convenience functions

- `plan({ cwd? })`: constructs `HarnessEngine` and calls `.plan()`.
- `apply({ cwd? })`: constructs `HarnessEngine` and calls `.apply()`.
- `doctor({ cwd?, json? })`: constructs `HarnessEngine` and calls `.doctor()`.
- `migrate({ cwd?, to?, dryRun?, json? })`: constructs `HarnessEngine` and calls `.migrate()`.
