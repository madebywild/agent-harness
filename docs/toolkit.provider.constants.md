# `packages/toolkit/src/provider-adapters/constants.ts`

## Purpose

Stores default generated output locations for each provider.

## Exports

- `PROVIDER_DEFAULTS`
- `getProviderDefaults(provider)`

## Default targets

- `codex`
  - prompt: `AGENTS.md`
  - skills: `.codex/skills`
  - MCP: `.codex/config.toml`
- `claude`
  - prompt: `CLAUDE.md`
  - skills: `.claude/skills`
  - MCP: `.mcp.json`
- `copilot`
  - prompt: `.github/copilot-instructions.md`
  - skills: `.github/skills`
  - MCP: `.vscode/mcp.json`
