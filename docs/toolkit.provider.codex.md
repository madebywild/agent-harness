# `packages/toolkit/src/provider-adapters/codex.ts`

## Purpose

Builds the Codex provider adapter.

## Export

- `buildCodexAdapter(skillFilesByEntityId)`

## Provider behavior

- Defaults from `PROVIDER_DEFAULTS.codex`.
- MCP format: TOML.
- Uses `renderProviderState` to merge enabled MCP/subagent/hook-state into one TOML artifact.
- Remote MCP server entries authored with `serverUrl` are rendered as Codex's current `url` field.
- TOML payload can include:
  - `mcp_servers` (merged MCP servers)
  - `agents.<id>` entries (enabled subagents, with `developer_instructions`, `description`, and supported
    provider-specific options)
  - inline `[hooks]` config plus `[features] codex_hooks = true` when Codex hook events are projected
  - `notify = [...]` (projected from hook `turn_complete`)
- Returns no artifact when merged payload is empty.
- Output string is normalized to one trailing newline.

## Subagent options

Codex subagents render inline under `[agents.<id>]` in `.codex/config.toml`. Provider override `options` support:

- `model`
- `tools`
- `reasoning` / `model_reasoning_effort`
- `sandbox_mode`
- `mcp_servers`
- `skills.config`
- `nickname_candidates`
