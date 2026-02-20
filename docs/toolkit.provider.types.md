# `packages/toolkit/src/provider-adapters/types.ts`

## Purpose

Defines adapter-specific supporting types used across provider adapter construction.

## Exports

- `SkillFileIndex`: read-only map from entity ID to loaded skill file content.
- `ProviderDefaults`: default target paths (`promptTarget`, `skillRoot`, `mcpTarget`).
- `ProviderMcpRenderer`: MCP renderer contract (`format` + `render(servers)`).
- `ProviderDefinition`: provider ID + defaults + renderer bundle.
- `ProviderBuilder`: function type producing a `ProviderAdapter`.
