# `packages/toolkit/src/provider-adapters/copilot.ts`

## Purpose

Builds the Copilot provider adapter.

## Export

- `buildCopilotAdapter(skillFilesByEntityId)`

## Provider definition

- Defaults from `PROVIDER_DEFAULTS.copilot`.
- MCP renderer: JSON via `createJsonMcpRenderer("servers")`.
- MCP output uses top-level `servers` property.
