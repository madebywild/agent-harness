# `packages/toolkit/src/versioning/registry.ts`

## Purpose

Defines the pluggable migration-step registry and migration-chain resolution helpers.

## Main APIs

- `createMigrationRegistry(steps)`
- `resolveMigrationChain(registry, kind, fromVersion, toVersion)`
- `runMigrationChain(registry, kind, fromVersion, toVersion, input)`
- `defaultMigrationRegistry`

## Behavior notes

- Registry creation groups steps by `kind` and sorts each group by `fromVersion`, then `toVersion`.
- Chains are resolved by matching `fromVersion` hops until `toVersion`.
- `fromVersion === toVersion` resolves to an empty chain; `fromVersion > toVersion` returns `null`.
- Steps that do not strictly advance version or that overshoot `toVersion` invalidate the chain.
- Missing hops return `null` and let callers decide fallback behavior.
- `runMigrationChain(...)` throws when no chain exists; otherwise it applies each step in-order and returns `{ output, appliedSteps }`.
