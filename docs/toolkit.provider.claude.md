# `packages/toolkit/src/provider-adapters/claude.ts`

## Purpose

Builds the Claude provider adapter.

## Export

- `buildClaudeAdapter(skillFilesByEntityId)`

## Provider behavior

- Defaults from `PROVIDER_DEFAULTS.claude`.
- MCP renderer: JSON via `createJsonMcpRenderer("mcpServers")`.
- MCP output uses top-level `mcpServers`.
- Subagents:
  - renders `.claude/agents/<id>.md`
  - frontmatter includes `name`, `description`, optional `tools`/`model`
- Hooks:
  - renders consolidated hook config to `.claude/settings.json` (or overridden target)
  - uses shared projection helper `renderClaudeHookSettings(...)`
