---
name: harness-prompt
description: Create and manage the system prompt entity in agent-harness, generating CLAUDE.md, AGENTS.md, and copilot-instructions.md from a single canonical source.
---

# harness-prompt

You are helping the user create or manage the **system prompt entity** in their agent-harness workspace. This skill covers the full workflow: scaffolding, editing, and applying the prompt to generate provider-native instruction files.

## What the `prompt` entity is

The `prompt` entity is the single, canonical system prompt for all AI coding providers. There can only be one, and its id is always `system`. It lives at:

```
.harness/src/prompts/system.md
```

The file is plain Markdown with optional YAML frontmatter. When you run `npx harness apply`, harness renders it into provider-native instruction files for every enabled provider.

## Provider output mapping

| Provider | Output path | Format | Read at |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | Markdown | Session start (every conversation) |
| OpenAI Codex CLI | `AGENTS.md` | Markdown | Once per run, before task execution |
| GitHub Copilot | `.github/copilot-instructions.md` | Markdown | Every relevant request |

### Claude Code — `CLAUDE.md`

- Loaded in full into context at the start of every session as a user-role message (not as the system prompt itself).
- Supports full Markdown: headers, bullets, code blocks, `@path/to/file` imports.
- Target **under 200 lines** — longer files consume more context and reduce adherence.
- Instructions must be specific and concrete to be reliably followed (e.g. "Run `pnpm test` before committing" rather than "test your changes").
- Can be placed at `./CLAUDE.md` or `./.claude/CLAUDE.md`; harness defaults to `CLAUDE.md`.
- Official docs: https://code.claude.com/docs/en/memory

### OpenAI Codex CLI — `AGENTS.md`

- Loaded once per run; injected as user-role messages near the top of conversation history, before the user prompt.
- Supports full Markdown; structured sections with headers and bullets work best.
- Default size cap: **32 KiB** combined across all discovered AGENTS.md files.
- Codex also discovers AGENTS.md files in subdirectories (root → CWD, concatenated in order); the root-level file provides baseline instructions.
- Official docs: https://developers.openai.com/codex/guides/agents-md

### GitHub Copilot — `.github/copilot-instructions.md`

- Applied automatically to all relevant Copilot requests in the repository.
- Supports Markdown; whitespace between instructions is ignored.
- Keep to **no more than ~2 pages** (roughly 8,000 characters). Instructions must not be task-specific — they should be reusable guidance.
- Recommended content: repo overview, build/test/lint commands, project layout, non-obvious dependencies.
- Official docs: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

## Provider-specific differences

| Concern | Claude Code | Codex CLI | Copilot |
|---|---|---|---|
| Size guidance | Under 200 lines | Under 32 KiB | ~2 pages / ~8 KB |
| Rich markdown | Yes — headers, code blocks, imports | Yes | Yes, but keep concise |
| Structured workflows | Works well | Works well | Stick to reusable context |
| Task-specific steps | OK | OK | Avoid — use `.github/instructions/` for that |

Content that works well everywhere: coding standards, project layout, build/test commands, naming conventions, language/framework preferences.

## Per-provider overrides

To customize the output path or content for a specific provider without changing the canonical source, create a sidecar override YAML:

```
.harness/src/prompts/system.overrides.<provider>.yaml
```

Minimal path override example (`.harness/src/prompts/system.overrides.claude.yaml`):

```yaml
version: 1
targetPath: ".claude/CLAUDE.md"
```

## Harness CLI commands

```bash
# Scaffold the source file (creates .harness/src/prompts/system.md)
npx harness add prompt

# Preview what will be written (dry run)
npx harness plan

# Generate provider artifacts (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md)
npx harness apply

# Watch for changes and auto-apply
npx harness watch

# Remove the prompt entity and its source file
npx harness remove prompt system
```

Enable providers before applying if you have not already:

```bash
npx harness provider enable claude
npx harness provider enable codex
npx harness provider enable copilot
```

## Example: well-structured `system.md`

```markdown
---
# Optional frontmatter — reserved for future harness use; leave empty or omit
---

# Project instructions

This is a TypeScript monorepo using pnpm workspaces and Turborepo.

## Stack

- Node >= 22, pnpm >= 9
- Biome for linting and formatting (2-space indent, double quotes, semicolons)
- Node built-in test runner via `tsx` for unit tests

## Commands

- `pnpm install` — install dependencies
- `pnpm build` — build all packages (respects Turbo dependency order)
- `pnpm test` — run unit tests (requires build)
- `pnpm check:write` — lint + format with auto-fix
- `pnpm typecheck` — type-check all packages

## Code conventions

- ESM only (`"type": "module"`), NodeNext module resolution
- Strict TypeScript: `noUncheckedIndexedAccess`, full `strict` mode
- Never duplicate logic — extract shared helpers
- Delete dead code; prefer concise expressions over boilerplate
- All public API functions must have explicit return types

## Project layout

- `packages/manifest-schema/` — Zod schemas and types (built first)
- `packages/toolkit/` — CLI and core engine
- `docs/` — documentation; update after any feature changes

## Git workflow

- Commit messages: `type: description` (conventional commits)
- Run `pnpm check:write && pnpm typecheck && pnpm test` before pushing
```

## Workflow summary

1. `npx harness add prompt` — creates `.harness/src/prompts/system.md`
2. Edit `.harness/src/prompts/system.md` with your project instructions
3. `npx harness apply` — writes `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`
4. Commit all generated files alongside the source

The generated files are owned by harness. Edit only the canonical source; re-run `apply` to propagate changes.
