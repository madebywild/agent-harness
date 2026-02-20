# `packages/toolkit/src/providers.ts`

## Purpose

Thin facade for provider adapter construction and provider default output path lookups.

## Exported APIs

- `buildBuiltinAdapters(skillFilesByEntityId)`
- `getDefaultPromptTarget(provider)`
- `getDefaultSkillRoot(provider)`
- `getDefaultMcpTarget(provider)`

## Notes

- Adapter creation delegates to `provider-adapters/registry.ts`.
- Default path lookups delegate to `provider-adapters/constants.ts`.
