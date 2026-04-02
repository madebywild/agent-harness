# `packages/toolkit/src/provider-adapters/subagents.ts`

## Purpose

Shared helpers for subagent rendering across provider adapters.

## Exports

- Option parsers:
  - `parseCodexSubagentOptions`
  - `parseClaudeSubagentOptions`
  - `parseCopilotSubagentOptions`
  - `parseCursorSubagentOptions`
- Option types:
  - `CodexSubagentOptions`
  - `ClaudeSubagentOptions`
  - `CopilotSubagentOptions`
  - `CursorSubagentOptions`
- Renderer helper:
  - `renderSubagentMarkdown`

## Behavior

- Reads provider override `options` only when it is an object (arrays/non-objects are ignored).
- Extracts known typed fields and drops invalid values:
  - Codex: `model?: string`, `tools?: string[]`
  - Claude: `model?: string`, `tools?: string | string[]`
  - Copilot: `model?: string`, `tools?: string[]`, `handoffs?: string[]`
  - Cursor: `model?: string`, `readonly?: boolean`, `is_background?: boolean`
- Ignores unknown option keys.
- Renders canonical subagent content as markdown with frontmatter keys `name`, `description`, plus provider-specific extras.
- Serializes frontmatter primitives (`string`, `string[]`, `boolean`) via JSON-style encoding, trims subagent body
  whitespace, and enforces a single trailing newline.
