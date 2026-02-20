# `packages/toolkit/src/versioning/registry.ts`

## Purpose

Defines the pluggable migration-step registry and migration-chain resolution helpers.

## Main APIs

- `createMigrationRegistry(steps)`
- `resolveMigrationChain(registry, kind, fromVersion, toVersion)`
- `runMigrationChain(registry, kind, fromVersion, toVersion, input)`
- `defaultMigrationRegistry`

## Behavior notes

- Chains are resolved by matching `fromVersion` hops until `toVersion`.
- Missing hops return `null` and let callers decide fallback behavior.
