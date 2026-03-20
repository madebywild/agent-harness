# `packages/toolkit/src/index.ts`

## Purpose

Public package entrypoint for programmatic use (`@madebywild/agent-harness-framework`).

## Re-exports

- `HarnessEngine`
- `loadConfig`, `validateConfig`, `validateLock`
- `runCliCommand`, `runCliArgv`
- `parseEnvFile`, `loadEnvVars`, `substituteEnvVars` from `env.ts`
- Core types from `types.ts` (manifest types, canonical models including `CanonicalHook`, diagnostics, operations, adapter contracts, version diagnostics/migration models)
- CLI contracts from `cli/contracts.ts` (`CommandInput`, `CommandOutput`, `CommandId`, `CliEnvelope`, context types)

## Convenience functions

- `plan({ cwd? })`
- `apply({ cwd? })`
- `doctor({ cwd?, json? })`
- `migrate({ cwd?, to?, dryRun?, json? })`
