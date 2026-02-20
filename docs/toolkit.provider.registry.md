# `packages/toolkit/src/provider-adapters/registry.ts`

## Purpose

Registers all builtin provider adapter builders.

## Export

- `buildProviderAdapters(skillFilesByEntityId)`

## Behavior

Returns a `Record<ProviderId, ProviderAdapter>` with entries for:

- `codex`
- `claude`
- `copilot`

Each adapter is created with the same skill file index to ensure consistent multi-provider renders for the current plan/apply cycle.
