# `packages/toolkit/src/u-haul.ts`

## Purpose

Implements `init --u-haul`, a legacy import flow that migrates provider-owned files into canonical `.harness/src/*` entities.

## Behavior

`u-haul` runs in two phases:

1. **Phase A (read-only planning)**
   - Detect legacy assets at default provider paths.
   - Parse and validate prompts, skills, MCP, subagents, hooks, settings, and commands.
   - Resolve provider precedence conflicts (`claude > codex > copilot` by default; override via `--u-haul-precedence`).
   - Plan deterministic id remaps for canonical id collisions (`-<type>`, then `-<n>`).
   - Build deletion list for imported legacy files/directories.
   - Abort before mutation if any parse/validation error exists.

2. **Phase B (mutation)**
   - Require git safety gate (git executable + inside worktree) before deletion.
   - Run workspace init.
   - Materialize canonical entities into `.harness/src/*`.
   - Auto-enable providers that contributed imported entities.
   - Delete imported legacy files/directories.
   - Run `apply`.

## Detection scope

- Prompt: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`
- Skills: `.codex/skills/*`, `.claude/skills/*`, `.github/skills/*`
- MCP: `.codex/config.toml` (`mcp_servers`), `.mcp.json` (`mcpServers`/`servers`), `.vscode/mcp.json` (`servers`)
- Subagents: `.codex/config.toml` (`agents`), `.claude/agents/*.md`, `.github/agents/*.agent.md`
- Hooks: `.codex/config.toml` (`notify`), `.claude/settings.json` (`hooks`), `.github/hooks/harness.generated.json`
- Settings: provider settings payloads after removing sections consumed by imported entities
- Commands: `.claude/commands/*.md`, `.github/prompts/*.prompt.md`

## Output summary

`init --u-haul` attaches `data.uHaul` to init output with:

- detected/imported counts by entity type
- precedence order
- auto-enabled providers
- deleted legacy paths
- precedence drops and collision remaps
- apply result summary (`operations`, `writtenArtifacts`, `prunedArtifacts`, `diagnostics`, `errorDiagnostics`)

When `errorDiagnostics > 0`, `init --u-haul` returns `ok: false` and non-zero exit code.
