# `packages/toolkit/src/provider-adapters/mcp.ts`

## Purpose

Provides MCP-specific composition logic shared by provider adapters.

## Exports

- `resolveMcpTargetPath(provider, defaultTargetPath, configs, overrideByEntity?)`
- `mergeMcpServers(configs)`

## `resolveMcpTargetPath`

- Collects `override.targetPath` values for participating MCP entities.
- Rejects conflicting target paths with an error.
- Uses the single override target if present, otherwise provider default target.
- Normalizes all returned paths as strict relative paths (rejects absolute paths, `..` segments, and paths that resolve to `"."`).

## `mergeMcpServers`

- Extracts server objects from each config (`servers`, `mcpServers`, or root object fallback).
- Merges all servers by server ID.
- Rejects conflicting definitions for the same server ID.
- Returns deterministically key-sorted merged server map.
