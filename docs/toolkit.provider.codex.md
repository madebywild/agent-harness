# `packages/toolkit/src/provider-adapters/codex.ts`

## Purpose

Builds the Codex provider adapter.

## Export

- `buildCodexAdapter(skillFilesByEntityId)`

## Provider behavior

- Defaults from `PROVIDER_DEFAULTS.codex`.
- MCP format: TOML.
- Uses `renderProviderState` to merge enabled MCP/subagent/hook-state into one TOML artifact.
- TOML payload can include:
  - `mcp_servers` (merged MCP servers)
  - `agents.<id>` entries (enabled subagents, with `developer_instructions` and `description`)
  - `notify = [...]` (projected from hook `turn_complete`)
- Returns no artifact when merged payload is empty.
- Output string is normalized to one trailing newline.
