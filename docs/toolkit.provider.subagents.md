# `packages/toolkit/src/provider-adapters/subagents.ts`

## Purpose

Shared helpers for subagent rendering across provider adapters.

## Exports

- Option parsers:
  - `parseCodexSubagentOptions`
  - `parseClaudeSubagentOptions`
  - `parseCopilotSubagentOptions`
- Renderer helper:
  - `renderSubagentMarkdown`

## Behavior

- Reads provider override `options` and extracts known typed fields (`model`, `tools`, `handoffs`).
- Ignores unknown/invalid option values.
- Renders canonical subagent content as markdown with YAML frontmatter (`name`, `description`, plus provider-specific extras).
