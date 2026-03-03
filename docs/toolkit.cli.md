# `packages/toolkit/src/cli/`

## Purpose

Implements the layered CLI runtime with shared command execution for both non-interactive and interactive frontends.

## Module layout

- `cli.ts`: compatibility bin wrapper that calls `runCliArgv`.
- `cli/main.ts`: mode selection + top-level error/exit mapping.
- `cli/contracts.ts`: shared command ids, input/output contracts, execution context, JSON envelope.
- `cli/command-registry.ts`: single command definition registry and `dispatch(...)` entrypoint.
- `cli/handlers/*`: command-family handlers that call `HarnessEngine`/registry validator and return structured outputs.
- `cli/renderers/text.ts`: command-output to human-readable stdout rendering.
- `cli/renderers/json.ts`: stable JSON envelope rendering (`schemaVersion: "1"`).
- `cli/adapters/commander.ts`: Commander parser adapter for script-safe command mode.
- `cli/adapters/interactive.ts`: prompt wizard adapter built with `@clack/prompts`.
- `cli/utils/runtime.ts`: TTY/CI/env mode helpers and context resolution.

## Runtime behavior

- Global options: `--cwd`, `--json`, `--interactive`, `--no-interactive`.
- No-arg behavior:
  - TTY and non-CI: launches interactive wizard.
  - Non-TTY or CI: runs default `plan` behavior.
- Explicit subcommands run through Commander command mode.
- `harness ui` is an explicit interactive entrypoint.

## JSON output contract

`--json` renders a consistent envelope:

- `schemaVersion: "1"`
- `ok: boolean`
- `command: string`
- `data: object`
- `diagnostics: Diagnostic[]`
- `meta: { cwd: string; durationMs: number }`

## Programmatic API

- `runCliCommand(input, context?)`: execute one structured command through shared dispatcher.
- `runCliArgv(argv, context?)`: parse argv, run selected mode, and return `{ exitCode }`.
