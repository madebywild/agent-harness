# `packages/toolkit/src/providers.ts`

## Purpose

Thin facade for provider adapter construction and provider default path lookups.

## Exported APIs

- `buildBuiltinAdapters(skillFilesByEntityId)`
- `getDefaultPromptTarget(provider)`
- `getDefaultSkillRoot(provider)`
- `getDefaultMcpTarget(provider)`

## Notes

- Adapter creation delegates to `provider-adapters/registry.ts`.
- Default path lookups delegate to `provider-adapters/constants.ts`.
- Hook defaults exist in provider constants (`hookTarget`) but no dedicated facade helper is exported yet.
