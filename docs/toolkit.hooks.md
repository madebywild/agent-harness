# `packages/toolkit/src/hooks.ts`

## Purpose

Parses and validates canonical hook source documents loaded from `.harness/src/hooks/<id>.json`.

## Core exports

- `CANONICAL_HOOK_EVENTS`: supported canonical lifecycle event names.
- `parseCanonicalHookDocument(input, sourcePath, entityId)`
- `canonicalHookHasErrors(diagnostics)`
- `stableHookCommandArray(command)`
- `withHookId(hook, id)`

## Validation behavior

- Root must be a JSON object.
- `mode`:
  - optional
  - defaults to `"strict"`
  - allowed values: `"strict"`, `"best_effort"`
- `events`:
  - required object
  - each key must be a supported canonical event
  - each event value must be an array of handlers

### `command` handler validation

- `type` must be `"command"`.
- Requires at least one command field:
  - `command`, `windows`, `linux`, `osx`, `bash`, or `powershell`
- `timeoutSec` / `timeout` must be positive numbers when present.
- `env` must be an object of string values.

### `notify` handler validation

- `type` must be `"notify"`.
- `event` supports only `"agent-turn-complete"` (defaults to this value when omitted).
- `command` must be a non-empty string or string array.
- `matcher` is not supported.

## Diagnostic families

Emits `HOOK_*` diagnostics for invalid mode/event/handler/timeout/env/notify shape.
