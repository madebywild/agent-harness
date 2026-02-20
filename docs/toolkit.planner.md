# `packages/toolkit/src/planner.ts`

## Purpose

Transforms canonical loaded state into:

- deterministic desired artifacts,
- filesystem operations (`create|update|delete|noop`),
- next lock data,
- next managed-index data,
- diagnostics.

## Exported API

- `buildPlan(paths, loaded, managedIndex, previousLock)`

## Planning flow

- Build provider adapters and render prompt/skill/MCP artifacts for enabled providers.
- Normalize artifact paths and coalesce by path.
- Detect output path collisions (`OUTPUT_PATH_COLLISION`):
  - cross-provider same-path collisions are always errors in v1, even with identical content.
  - same-provider collisions with different content are errors.
- Compare desired outputs with disk state and managed index:
  - missing file => `create`
  - managed + changed => `update`
  - managed + unchanged => `noop`
  - unmanaged existing target => diagnostic `OUTPUT_COLLISION_UNMANAGED`
- Emit deletes for stale managed outputs not present in desired set.

## Lock/index behavior

- Lock payload includes manifest fingerprint + entity and output hashes.
- `generatedAt` remains byte-stable when semantic payload is unchanged.
- Managed index tracks:
  - `managedSourcePaths` from manifest source/overrides.
  - `managedOutputPaths` from desired artifact set.
