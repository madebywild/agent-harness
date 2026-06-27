# `packages/toolkit/src/provider-adapters/hooks.ts`

## Purpose

Shared hook projection utilities for provider adapters.

## Core exports

- `resolveHookTargetPath(provider, defaultTargetPath, hookIds, overrideByEntity?)`
- `renderClaudeHookSettings(hooks)`
- `renderCopilotHookConfig(hooks)`
- `renderCursorHookConfig(hooks)`
- `renderCodexHookConfigObject(hooks)`
- `resolveCodexNotifyCommand(hooks)`

Provider event names and matcher support are shared through `hook-capabilities.ts` so forward rendering and `u-haul`
reverse imports use the same mapping.

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

### Cursor

- Maps canonical events to Cursor hook event names (for example `pre_tool_use -> preToolUse` and
  `prompt_submit -> beforeSubmitPrompt`).
- Supports canonical `command` handlers.
- Supports optional `matcher` and `timeout`.
- Treats `cwd` and `env` as unsupported command fields.
- Emits JSON shape:
  - `{ "version": 1, "hooks": { "<eventName>": [...] } }`

### Codex

- Maps canonical `session_start`, `prompt_submit`, `pre_tool_use`, `permission_request`, `post_tool_use`, `subagent_start`,
  `subagent_stop`, `pre_compact`, `post_compact`, and `stop` into Codex inline `[hooks]` tables.
- Emits `[features] hooks = true` when lifecycle hooks are projected.
- Supports `statusMessage` on Codex lifecycle command handlers.
- Projects canonical `turn_complete` as the legacy top-level `notify = [...]` command.
- Normalizes either canonical `notify` or `command` `turn_complete` handlers into notify command arrays.
- Returns one merged notify command, failing on incompatible multiple values (`HOOK_NOTIFY_CONFLICT`).

## Strict vs best-effort

- `mode: "strict"`: unsupported provider capability throws `HOOK_EVENT_UNSUPPORTED`.
- `mode: "best_effort"`: unsupported capability is skipped.
