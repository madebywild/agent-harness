# `packages/toolkit/src/provider-adapters/codex.ts`

## Purpose

Builds the Codex provider adapter.

## Export

- `buildCodexAdapter(skillFilesByEntityId)`

## Provider definition

- Defaults from `PROVIDER_DEFAULTS.codex`.
- MCP format: `toml`.
- Uses `renderProviderState` to merge MCP + subagent data into one TOML artifact.
- TOML payload shape:
  - `mcp_servers` for merged MCP servers (when present)
  - `experimental_use_role = true` when at least one subagent is enabled
  - `agents.<id>` entries for enabled subagents
- Output string is normalized to one trailing newline.
