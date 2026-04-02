# `packages/toolkit/src/provider-adapters/cursor.ts`

## Purpose

Builds the Cursor provider adapter.

## Export

- `buildCursorAdapter(skillFilesByEntityId)`

## Provider behavior

- Defaults from `PROVIDER_DEFAULTS.cursor`.
- MCP renderer: JSON via `createJsonMcpRenderer("mcpServers")`.
- MCP output uses top-level `mcpServers`.
- Prompt projection is intentionally disabled in v1.
- Command projection is intentionally disabled in v1.
- Settings projection is intentionally disabled in v1.
- Subagents:
  - renders `.cursor/agents/<id>.md`
  - frontmatter includes `name`, `description`, optional `model`/`readonly`/`is_background`
  - value precedence is override `options` first, then canonical subagent metadata
- Hooks:
  - renders consolidated hook config to `.cursor/hooks.json` (or overridden target)
  - uses shared projection helper `renderCursorHookConfig(...)`
