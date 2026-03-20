# `packages/toolkit/src/provider-adapters/copilot.ts`

## Purpose

Builds the Copilot provider adapter.

## Export

- `buildCopilotAdapter(skillFilesByEntityId)`

## Provider behavior

- Defaults from `PROVIDER_DEFAULTS.copilot`.
- MCP renderer: JSON via `createJsonMcpRenderer("servers")`.
- MCP output uses top-level `servers`.
- Subagents:
  - renders `.github/agents/<id>.agent.md`
  - frontmatter includes `name`, `description`, optional `tools`/`model`/`handoffs`
- Hooks:
  - renders consolidated hook config to `.github/hooks/harness.generated.json` (or overridden target)
  - uses shared projection helper `renderCopilotHookConfig(...)`
