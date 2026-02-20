# `packages/toolkit/src/index.ts`

## Purpose

Public package entrypoint for programmatic use.

## Re-exports

- `HarnessEngine`
- `loadConfig`, `validateConfig`, `validateLock`
- Core types from `types.ts` (manifest types, diagnostics, operations, adapter contracts, etc.)

## Convenience functions

- `plan({ cwd? })`: constructs `HarnessEngine` and calls `.plan()`.
- `apply({ cwd? })`: constructs `HarnessEngine` and calls `.apply()`.
