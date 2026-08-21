# `packages/toolkit/src/provider-adapters/create-adapter.ts`

## Purpose

Implements the shared adapter builder used by all concrete providers.

## Export

- `createProviderAdapter(definition, skillFilesByEntityId)`

## Rendering behavior

- Prompt sections (`renderPromptSections`):
  - filters out sections whose override sets `enabled === false`; zero enabled sections emits no artifact.
  - groups sections by resolved output path (override `targetPath` or provider default `promptTarget`, honoring `target` on nesting providers), so sections sharing a path merge into one file.
  - within each group, composes section bodies (frontmatter already stripped) in `order` then id, joined by a blank line, with a single trailing newline.
- Skill:
  - respects `override.enabled === false`.
  - uses override `targetPath` or default `<skillRoot>/<skillId>`.
  - emits one artifact per skill file; JSON extension maps to `format: "json"`, otherwise `markdown`.
- MCP:
  - filters out disabled entities via override.
  - resolves single target path via `resolveMcpTargetPath`.
  - merges servers via `mergeMcpServers`.
  - delegates serialization to provider `mcpRenderer`.
- Subagents:
  - not handled in this shared builder.
  - provider-specific adapters implement `renderSubagent` (Claude/Copilot) or `renderProviderState` (Codex shared TOML).
- Hooks:
  - not handled in this shared builder.
  - provider-specific adapters implement `renderHooks` (Copilot) or `renderProviderState` (Claude/Codex).
- Commands:
  - not handled in this shared builder.
  - provider-specific adapters implement `renderCommand` (Claude/Copilot).
- Settings:
  - not handled in this shared builder.
  - provider-specific adapters implement `renderSettings` (Copilot) or `renderProviderState` (Claude/Codex).

## Ownership tagging

- Skill artifacts use a single owner entity ID.
- Prompt and MCP artifact owners are a sorted comma-separated list of the contributing entity IDs.
