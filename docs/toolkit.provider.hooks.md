# `packages/toolkit/src/provider-adapters/hooks.ts`

## Purpose

Shared hook projection utilities for provider adapters.

## Core exports

- `resolveHookTargetPath(provider, defaultTargetPath, hookIds, overrideByEntity?)`
- `renderClaudeHookSettings(hooks)`
- `renderCopilotHookConfig(hooks)`
- `resolveCodexNotifyCommand(hooks)`

## Provider projections

### Claude

- Maps canonical events to Claude event names (for example `pre_tool_use -> PreToolUse`).
- Supports canonical `command` handlers.
- Groups handlers by matcher for matcher-capable events.
- Emits JSON shape:
  - `{ "hooks": { "<EventName>": [{ matcher?, hooks: [...] }] } }`

### Copilot

- Maps canonical events to Copilot CLI event names (for example `pre_tool_use -> preToolUse`).
- Supports canonical `command` handlers.
- Matcher is unsupported.
- Emits JSON shape:
  - `{ "version": 1, "hooks": { "<eventName>": [...] } }`

### Codex

- Projects canonical `turn_complete` events in all modes; strict mode controls whether unsupported events throw vs. are skipped.
- Normalizes either canonical `notify` or `command` handlers into notify command arrays.
- Returns one merged notify command, failing on incompatible multiple values (`HOOK_NOTIFY_CONFLICT`).

## Strict vs best-effort

- `mode: "strict"`: unsupported provider capability throws `HOOK_EVENT_UNSUPPORTED`.
- `mode: "best_effort"`: unsupported capability is skipped.
