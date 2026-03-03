# `packages/toolkit/src/provider-adapters/claude.ts`

## Purpose

Builds the Claude provider adapter.

## Export

- `buildClaudeAdapter(skillFilesByEntityId)`

## Provider definition

- Defaults from `PROVIDER_DEFAULTS.claude`.
- MCP renderer: JSON via `createJsonMcpRenderer("mcpServers")`.
- MCP output uses top-level `mcpServers` property.
- Adds `renderSubagent` output at `.claude/agents/<id>.md` with frontmatter (`name`, `description`, optional `tools`/`model`).
