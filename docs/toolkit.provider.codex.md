# `packages/toolkit/src/provider-adapters/codex.ts`

## Purpose

Builds the Codex provider adapter.

## Export

- `buildCodexAdapter(skillFilesByEntityId)`

## Provider definition

- Defaults from `PROVIDER_DEFAULTS.codex`.
- MCP format: `toml`.
- TOML payload shape:
  - top-level key: `mcp_servers`
- Output string is normalized to one trailing newline.
