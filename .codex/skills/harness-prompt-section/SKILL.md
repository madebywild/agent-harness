---
name: harness-prompt-section
description: Create and manage composable prompt-section entities in agent-harness, which compose into CLAUDE.md, AGENTS.md, and copilot-instructions.md from canonical sources.
---

# harness-prompt-section

You are helping the user create or manage **prompt-section entities** in their agent-harness workspace. Prompt-sections are modular chunks of a system prompt; harness composes every enabled section into one system-prompt file per provider. This skill covers scaffolding, editing, ordering, and applying them.

## What a `prompt-section` entity is

A prompt-section is one composable part of the system prompt. A workspace can have any number of them, each identified by a unique `id`. Each lives in its own directory:

```
.harness/src/prompt-sections/<id>/SECTION.md
```

`SECTION.md` is plain Markdown with optional YAML frontmatter (the frontmatter is stripped before composition; only the body is used). When you run `npx harness apply`, harness concatenates every enabled section — in composition order — into the provider-native instruction file for each enabled provider. A single section produces a file byte-identical to authoring that prompt directly.

There is no separate monolithic "prompt" entity anymore. To create one system prompt, add a single section (e.g. `system`); to compose several, add several.

## Composition and ordering

- Sections compose in `order` (a nonnegative integer on each entity), tie-broken by `id`.
- `npx harness add prompt-section <id>` appends the new section at the bottom (its `order` is the current maximum + 1).
- Section bodies are joined with a blank line, in order, with no injected headings or markers — author your own headings inside each `SECTION.md`.
- To reorder, edit the `order` values in `.harness/manifest.json` and re-run `apply`.
- A section can be disabled for a single provider via its override sidecar (`enabled: false`); it still composes for the others.

## Provider output mapping

| Provider | Output path | Format | Read at |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | Markdown | Session start (every conversation) |
| OpenAI Codex CLI | `AGENTS.md` | Markdown | Once per run, before task execution |
| GitHub Copilot | `.github/copilot-instructions.md` | Markdown | Every relevant request |

(Cursor does not receive a composed system prompt.)

### Claude Code — `CLAUDE.md`

- Loaded in full into context at the start of every session as a user-role message (not as the system prompt itself).
- Supports full Markdown: headers, bullets, code blocks, `@path/to/file` imports.
- Target **under 200 lines** across all composed sections — longer files consume more context and reduce adherence.
- Instructions must be specific and concrete to be reliably followed (e.g. "Run `pnpm test` before committing" rather than "test your changes").
- Official docs: https://code.claude.com/docs/en/memory

### OpenAI Codex CLI — `AGENTS.md`

- Loaded once per run; injected as user-role messages near the top of conversation history, before the user prompt.
- Supports full Markdown; structured sections with headers and bullets work best.
- Default size cap: **32 KiB** combined across all discovered AGENTS.md files.
- Official docs: https://developers.openai.com/codex/guides/agents-md

### GitHub Copilot — `.github/copilot-instructions.md`

- Applied automatically to all relevant Copilot requests in the repository.
- Supports Markdown; whitespace between instructions is ignored.
- Keep the composed file to **no more than ~2 pages** (roughly 8,000 characters). Instructions must not be task-specific — they should be reusable guidance.
- Official docs: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

## Monorepo targeting

A prompt-section may carry a `target` (a package directory). Sections are grouped by their resolved output path, so sections targeting `packages/web` compose into `packages/web/CLAUDE.md` (for providers that nest the prompt, i.e. Claude Code), while untargeted sections compose into the repository-root file. Untargeted, non-monorepo workspaces render exactly as before.

## Per-provider overrides

To disable a section for one provider or point it at a custom output path, create a sidecar override YAML next to `SECTION.md`:

```
.harness/src/prompt-sections/<id>/OVERRIDES.<provider>.yaml
```

Example (`.harness/src/prompt-sections/system/OVERRIDES.claude.yaml`):

```yaml
version: 1
enabled: false        # omit this section from CLAUDE.md, keep it for other providers
```

## Harness CLI commands

```bash
# Scaffold a section (creates .harness/src/prompt-sections/<id>/SECTION.md, appended at the bottom)
npx harness add prompt-section <id>

# Pull a shared section from a registry
npx harness add prompt-section <id> --registry <name>

# Preview what will be written (dry run)
npx harness plan

# Generate provider artifacts (CLAUDE.md, AGENTS.md, .github/copilot-instructions.md)
npx harness apply

# Watch for changes and auto-apply
npx harness watch

# Remove a section and its source directory
npx harness remove prompt-section <id>
```

Enable providers before applying if you have not already:

```bash
npx harness provider enable claude
npx harness provider enable codex
npx harness provider enable copilot
```

## Example: a well-structured `SECTION.md`

```markdown
---
name: system
description: Baseline project instructions.
---

# Project instructions

This is a TypeScript monorepo using pnpm workspaces and Turborepo.

## Commands

- `pnpm build` — build all packages (respects Turbo dependency order)
- `pnpm test` — run unit tests (requires build)
- `pnpm check:write` — lint + format with auto-fix

## Code conventions

- ESM only (`"type": "module"`), NodeNext module resolution
- Never duplicate logic — extract shared helpers
- All public API functions must have explicit return types
```

## Workflow summary

1. `npx harness add prompt-section system` — creates `.harness/src/prompt-sections/system/SECTION.md`
2. Edit the `SECTION.md` with your project instructions (add more sections for modular topics)
3. `npx harness apply` — composes all sections into `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`
4. Commit all generated files alongside the sources

The generated files are owned by harness. Edit only the canonical sources; re-run `apply` to propagate changes.
