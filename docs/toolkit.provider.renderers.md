# `packages/toolkit/src/provider-adapters/renderers.ts`

## Purpose

Defines reusable renderer factories for provider-specific MCP output formats.

## Export

- `createJsonMcpRenderer(serverProperty)`

## Behavior

- Returns a `ProviderMcpRenderer` with `format: "json"`.
- Wraps merged servers under the configured top-level property:
  - `mcpServers` (Claude)
  - `servers` (Copilot)
- Serializes output via deterministic `stableStringify`.
