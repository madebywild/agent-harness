# `packages/toolkit/src/provider-adapters/registry.ts`

## Purpose

Registers builtin provider adapter builders.

## Export

- `buildProviderAdapters(skillFilesByEntityId)`

## Behavior

Returns a `Record<ProviderId, ProviderAdapter>` with entries for:

- `codex`
- `claude`
- `copilot`

Each adapter is built with the same skill-file index for deterministic multi-provider render cycles. Returned adapters include hook-capable renderers (`renderHooks` and/or hook-aware `renderProviderState`) where supported.
