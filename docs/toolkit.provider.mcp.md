# `packages/toolkit/src/provider-adapters/mcp.ts`

## Purpose

Provides MCP-specific composition logic shared by provider adapters.

## Exports

- `resolveMcpTargetPath(provider, defaultTargetPath, configs, overrideByEntity?)`
- `mergeMcpServers(configs)`
- `normalizeMcpServerUrlField(server)`
- `normalizeMcpServersUrlField(servers)`

## `resolveMcpTargetPath`

- Collects `override.targetPath` values for participating MCP entities.
- Rejects conflicting target paths with an error.
- Uses the single override target if present, otherwise provider default target.
- Normalizes all returned paths as strict relative paths (rejects absolute paths, Windows drive-prefixed paths, `..` segments, and paths that resolve to `"."`).

## `mergeMcpServers`

- Extracts server objects from each config (`servers`, `mcpServers`, or root object fallback).
- Normalizes each server definition with `normalizeMcpServerUrlField` before merging, so collision comparison sees
  equivalent `serverUrl`/`url` definitions as identical.
- Merges all servers by server ID.
- Rejects conflicting definitions for the same server ID.
- Returns deterministically key-sorted merged server map.

## `normalizeMcpServerUrlField` / `normalizeMcpServersUrlField`

Every supported provider (Claude Code `.mcp.json`, GitHub Copilot `.vscode/mcp.json`, Cursor `.cursor/mcp.json`, and
OpenAI Codex CLI `.codex/config.toml`) reads a remote MCP server's endpoint from a field named `url` — there is no
provider that expects `serverUrl`. These helpers rewrite a `serverUrl` key to `url` (dropping `serverUrl`, and
preferring an existing `url` if both are present) so `serverUrl` is accepted as a legacy authoring alias without ever
leaking into a rendered artifact. `mergeMcpServers` calls this automatically for every provider; adapters that build
server maps outside of `mergeMcpServers` (for example Codex subagent-scoped `mcp_servers` overrides) call
`normalizeMcpServersUrlField` directly.
