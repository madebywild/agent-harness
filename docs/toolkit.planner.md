# `packages/toolkit/src/planner.ts`

## Purpose

Transforms loaded canonical state into:

- deterministic desired artifacts
- filesystem operations (`create|update|delete|noop`)
- next lock payload
- next managed-index payload
- diagnostics

## Exported API

- `buildPlan(paths, loaded, managedIndex, previousLock)`

## Planning flow

- Builds provider adapters and renders prompt/skill/MCP/subagent/hook artifacts for enabled providers.
- Supports composite provider-state rendering (`renderProviderState`) for shared artifacts (Codex `.codex/config.toml`).
- Supports dedicated hook rendering (`renderHooks`) for providers with separate hook files.
- Normalizes artifact paths and coalesces by path.
- Detects output collisions (`OUTPUT_PATH_COLLISION`):
  - cross-provider same-path collisions are errors
  - same-provider collisions with different content are errors
- Compares desired outputs with disk state and managed index:
  - missing file => `create`
  - managed + changed => `update`
  - managed + unchanged => `noop`
  - unmanaged existing target => `OUTPUT_COLLISION_UNMANAGED` diagnostic
- Emits `delete` for stale managed outputs not present in desired set.

## Lock/index behavior

- Lock payload includes manifest fingerprint and entity/output hashes.
- Hook entities participate in lock entity records.
- `generatedAt` remains byte-stable when semantic lock payload is unchanged.
- Managed index tracks:
  - `managedSourcePaths` from manifest source/overrides
  - `managedOutputPaths` from desired artifact set
