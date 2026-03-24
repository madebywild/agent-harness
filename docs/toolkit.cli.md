# `packages/toolkit/src/cli/`

## Purpose

Implements the layered CLI runtime with shared command execution for both non-interactive and interactive frontends.

## Module layout

- `cli.ts`: compatibility bin wrapper that calls `runCliArgv`.
- `cli/main.ts`: mode selection + top-level error/exit mapping.
- `cli/contracts.ts`: shared command IDs, input/output contracts, execution context, JSON envelope.
- `cli/command-registry.ts`: command definitions and `dispatch(...)`.
- `cli/handlers/*`: command-family handlers calling `HarnessEngine` and validators.
- `cli/renderers/text.ts`: human-readable stdout rendering.
- `cli/renderers/json.ts`: stable JSON envelope rendering (`schemaVersion: "1"`).
- `cli/adapters/commander.ts`: Commander parser adapter.
- `cli/adapters/interactive.tsx`: prompt wizard adapter (Ink + `@inkjs/ui` React components).
- `cli/adapters/autocomplete-select.tsx`: type-to-filter select component used by the interactive adapter for all selection prompts.
- `cli/utils/runtime.ts`: TTY/CI/env mode helpers and context resolution.

## Runtime behavior

- Global options: `--cwd`, `--json`, `--interactive`, `--no-interactive`.
- No-arg behavior:
  - TTY and non-CI: interactive wizard.
  - non-TTY or CI: default `plan`.
- Explicit subcommands run through Commander mode.
- `harness ui` is the explicit interactive entrypoint.
- Interactive `init` now offers bundled preset selection with a skip option.
- Interactive `init` can also launch delegated prompt authoring when the `delegate` preset is selected.

## Workspace-aware interactive startup

On every interactive launch, `runInteractiveAdapter` detects workspace state before rendering:

- **No workspace** (`.harness/` missing): shows an animated onboarding wizard that guides the user through init (with optional preset), multi-provider enablement (pick one or more, then confirm), optional system prompt creation, and apply. The onboarding transitions to the main command menu on completion.
- **Unhealthy workspace** (doctor finds issues): shows a warning banner listing diagnostics and offers to run `doctor` or continue to the main menu.
- **Healthy workspace**: shows the command menu directly (existing behavior).

Detection uses `resolveHarnessPaths` + `exists` for the fast path and `runDoctor` when the workspace exists. The `WorkspaceStatus` type and `detectWorkspaceStatus` function are exported from `interactive.tsx` for testability.

## Notable command surface

- `add prompt|skill|mcp|subagent|hook`
- `skill find <query>`
- `skill import <source> --skill <upstream-skill> [--as <harness-id>] [--replace] [--allow-unsafe] [--allow-unaudited]`
- `remove <entity-type> <id>` (entity-type includes `hook`)
- registry commands support optional entity-type filters including `hook`
- preset commands: `preset list|describe|apply`
- `init --preset <id>` chains workspace initialization with preset application
- `init --delegate <provider>` auto-applies the bundled `delegate` preset and launches `claude`, `codex`, or `copilot` to finish prompt authoring

Examples:

- Safe discovery: `harness skill find "web design"`
- Strict import (default audit gates): `harness skill import vercel-labs/agent-skills --skill web-design-guidelines`
- Replace existing local skill: `harness skill import vercel-labs/agent-skills --skill web-design-guidelines --replace`
- Explicit unsafe override: `harness skill import <source> --skill <id> --allow-unsafe`
- Explicit unaudited override: `harness skill import <source> --skill <id> --allow-unaudited`

## JSON output contract

`--json` renders:

- `schemaVersion: "1"`
- `ok: boolean`
- `command: string`
- `data: object`
- `diagnostics: Diagnostic[]`
- `meta: { cwd: string; durationMs: number }`

`skill find` returns both parsed matches and raw text fallback in `data`.
`skill import` returns imported id/provenance, audit decision, sidecar metadata path, and imported file count.

## Programmatic API

- `runCliCommand(input, context?)`
- `runCliArgv(argv, context?)`

## Preset behavior

- `preset list` returns bundled presets by default and includes local presets when the workspace exists.
- `preset list --registry <name>` lists presets exposed by a configured git registry.
- `preset describe <id>` resolves a preset and returns its metadata plus ordered operations.
- `preset apply <id>` materializes normal harness state into the workspace; the preset itself is not persisted in `manifest.json`.
- Bundled presets: `delegate` (bootstrap prompt for delegated authoring), `starter` (prompt + reviewer skill + fix-issue command), `researcher` (prompt + research subagent), `yolo` (prompt + permissive settings for all providers). All four enable `claude`, `codex`, and `copilot`.
- `init --delegate <provider>` is the intended first-run path when the user wants `claude`, `codex`, or `copilot` to author the real project-specific prompt and any related harness entities from the current repository context.
- Delegated init is interactive-only and should not be combined with `--json`, because the selected provider CLI takes over the terminal session.
- Provider CLIs are invoked non-interactively: `claude -p <task>`, `codex exec <task>`, `copilot -p <task>`. See [`toolkit.delegated-init.md`](./toolkit.delegated-init.md) for details.
