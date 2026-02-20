# `packages/toolkit/src/provider-adapters/create-adapter.ts`

## Purpose

Implements the shared adapter builder used by all concrete providers.

## Export

- `createProviderAdapter(definition, skillFilesByEntityId)`

## Rendering behavior

- Prompt:
  - respects `override.enabled === false` to skip generation.
  - uses override `targetPath` or provider default `promptTarget`.
  - writes canonical prompt body with a single trailing newline.
- Skill:
  - respects `override.enabled === false`.
  - uses override `targetPath` or default `<skillRoot>/<skillId>`.
  - emits one artifact per skill file; JSON extension maps to `format: "json"`, otherwise `markdown`.
- MCP:
  - filters out disabled entities via override.
  - resolves single target path via `resolveMcpTargetPath`.
  - merges servers via `mergeMcpServers`.
  - delegates serialization to provider `mcpRenderer`.

## Ownership tagging

- Prompt/skill artifacts use a single owner entity ID.
- MCP artifact owner is a sorted comma-separated list of contributing MCP entity IDs.
