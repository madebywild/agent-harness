# `packages/toolkit/src/provider-adapters/renderers.ts`

## Purpose

Defines reusable JSON renderer factories for provider-specific MCP output formats.

## Export

- `createJsonMcpRenderer(serverProperty)`

## Behavior

- Returns a `ProviderMcpRenderer` with `format: "json"`.
- Wraps merged servers under the configured top-level property:
  - `mcpServers` (Claude)
  - `servers` (Copilot)
- Serializes output via deterministic `stableStringify`.
- Scope note: Codex uses an inline TOML MCP renderer in `packages/toolkit/src/provider-adapters/codex.ts` (`mcp_servers`) and
  does not use this helper.
