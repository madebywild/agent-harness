# Hook Authoring Guide

This guide shows how to author canonical lifecycle hooks in `.harness/src/hooks/<id>.json` and what each provider receives after `harness apply`.

## Quick start

1. Create a hook entity:

```bash
npx harness add hook guard
```

2. Edit `.harness/src/hooks/guard.json`.
3. Enable providers as needed:

```bash
npx harness provider enable claude
npx harness provider enable copilot
npx harness provider enable codex
```

4. Apply:

```bash
npx harness apply
```

## Canonical hook document shape

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "command": "echo pre-tool",
        "timeoutSec": 10
      }
    ]
  }
}
```

## `mode` behavior

- `strict`:
  - unsupported provider/event/handler combinations fail with diagnostics (for example `HOOK_EVENT_UNSUPPORTED`)
- `best_effort`:
  - unsupported combinations are skipped during projection

## Supported canonical events

`session_start`, `session_end`, `prompt_submit`, `pre_tool_use`, `permission_request`, `post_tool_use`, `post_tool_failure`, `notification`, `subagent_start`, `subagent_stop`, `stop`, `stop_failure`, `teammate_idle`, `task_completed`, `instructions_loaded`, `config_change`, `worktree_create`, `worktree_remove`, `pre_compact`, `post_compact`, `elicitation`, `elicitation_result`, `error`, `turn_complete`, `setup`, `user_prompt_expansion`, `permission_denied`, `post_tool_batch`, `cwd_changed`, `file_changed`, `task_created`

> The Claude-aligned events `setup`, `user_prompt_expansion`, `permission_denied`, `post_tool_batch`, `cwd_changed`, `file_changed`, and `task_created` currently project only to Claude. On Codex, Copilot, and Cursor they are unsupported and behave per the chosen `mode`: `strict` raises `HOOK_EVENT_UNSUPPORTED`, `best_effort` silently skips them.

> Only the `command` and `notify` handler types are supported. Provider-specific HTTP and prompt-driven hook handlers (documented for Claude) are not yet modelled in the canonical schema and require validation-backed schema work before they can be added.

## Handler types

### `command`

Supported fields:

- `matcher` (event/provider-dependent)
- command fields:
  - `command`
  - `windows`
  - `linux`
  - `osx`
  - `bash`
  - `powershell`
- `cwd`
- `env` (string map)
- `timeoutSec`
- `timeout`
- `statusMessage` (Codex lifecycle hooks only)

At least one command field is required.

### `notify`

Supported fields:

- `event` (currently only `"agent-turn-complete"`)
- `command` (string or string array)

`matcher` is not supported on `notify`.

## Provider projection matrix

| Provider | Supported canonical events | Handler types |
| --- | --- | --- |
| Claude | most lifecycle events (mapped to Claude names) | `command` |
| Copilot | `session_start`, `session_end`, `prompt_submit`, `pre_tool_use`, `post_tool_use`, `stop`, `subagent_stop`, `error` | `command` |
| Codex | `session_start`, `prompt_submit`, `pre_tool_use`, `permission_request`, `post_tool_use`, `subagent_start`, `subagent_stop`, `pre_compact`, `post_compact`, `stop`, plus legacy `turn_complete` notification | `command` for lifecycle hooks; `notify` and `command` for `turn_complete` |

## Codex lifecycle hooks and notifications

Codex lifecycle hooks render inline in `.codex/config.toml` under `[hooks]` and enable the canonical feature flag:

```toml
[features]
hooks = true

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 scripts/check_bash.py"
timeout = 30
statusMessage = "Checking Bash command"
```

Codex matcher support covers `session_start`, `pre_tool_use`, `permission_request`, `post_tool_use`, `subagent_start`, `subagent_stop`, `pre_compact`, and `post_compact` (only `prompt_submit` and `stop` ignore matchers). `cwd` and `env` are not supported for Codex lifecycle command hooks.

For legacy Codex notifications, `turn_complete` handlers still render to top-level `notify = [...]`. Both `notify` and `command` handler types are converted into a TOML notify command array:

- `notify` handlers: the `command` field is used directly (arrays pass through; strings are wrapped as `["sh", "-lc", "<command>"]`).
- `command` handlers: the first available command field (`command`, `bash`, `linux`, `osx`, `powershell`, `windows`) is selected and wrapped the same way.

Only one notify command is allowed across all enabled hooks. If multiple hooks define different notify commands, apply fails with `HOOK_NOTIFY_CONFLICT`.

## Copy/paste recipes

### 1) Claude + Copilot pre-tool guard

Canonical source:

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "bash": "node scripts/hook-pre-tool.js",
        "powershell": "node scripts/hook-pre-tool.js",
        "timeoutSec": 15
      }
    ]
  }
}
```

Resulting outputs:

- Claude:
  - `.claude/settings.json` with `hooks.PreToolUse`
- Copilot:
  - `.github/hooks/harness.generated.json` with `hooks.preToolUse`

### 2) Claude matcher-based tool policy

Canonical source:

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "matcher": "Bash",
        "command": "python3 scripts/check_bash_policy.py"
      }
    ]
  }
}
```

Expected Claude output fragment:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 scripts/check_bash_policy.py"
          }
        ]
      }
    ]
  }
}
```

### 3) Copilot session + tool hooks

Canonical source:

```json
{
  "mode": "strict",
  "events": {
    "session_start": [
      {
        "type": "command",
        "bash": "echo session-start",
        "powershell": "Write-Output session-start"
      }
    ],
    "post_tool_use": [
      {
        "type": "command",
        "bash": "node scripts/post_tool.js",
        "powershell": "node scripts/post_tool.js"
      }
    ]
  }
}
```

Expected Copilot output fragment:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "echo session-start",
        "powershell": "Write-Output session-start"
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "bash": "node scripts/post_tool.js",
        "powershell": "node scripts/post_tool.js"
      }
    ]
  }
}
```

### 4) Codex pre-tool guard

Canonical source:

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "matcher": "^Bash$",
        "command": "python3 scripts/check_bash.py",
        "timeout": 30,
        "statusMessage": "Checking Bash command"
      }
    ]
  }
}
```

Expected Codex output fragment in `.codex/config.toml`:

```toml
[features]
hooks = true

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "python3 scripts/check_bash.py"
timeout = 30
statusMessage = "Checking Bash command"
```

### 5) Codex turn-complete notification

Canonical source:

```json
{
  "mode": "strict",
  "events": {
    "turn_complete": [
      {
        "type": "notify",
        "command": ["python3", "scripts/on_turn_complete.py"]
      }
    ]
  }
}
```

Expected Codex output fragment in `.codex/config.toml`:

```toml
notify = ["python3", "scripts/on_turn_complete.py"]
```

### 6) One file for all providers (`best_effort`)

Canonical source:

```json
{
  "mode": "best_effort",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "bash": "node scripts/pre_tool.js",
        "powershell": "node scripts/pre_tool.js"
      }
    ],
    "turn_complete": [
      {
        "type": "notify",
        "command": ["python3", "scripts/on_turn_complete.py"]
      }
    ]
  }
}
```

Behavior:

- Claude/Copilot/Codex use `pre_tool_use`.
- Codex also uses `turn_complete`.
- Unsupported parts are skipped instead of failing.

## Target path overrides

Hook sidecar path:

- `.harness/src/hooks/<id>.overrides.<provider>.yaml`

Example:

```yaml
version: 1
targetPath: ".github/hooks/security.generated.json"
```

Rules:

- Per-provider overrides can change output target.
- If multiple enabled hook entities for one provider resolve to different target paths, apply fails with `HOOK_TARGET_CONFLICT` (for Claude/Copilot). For Codex, hook `targetPath` overrides are resolved via the shared `.codex/config.toml` target resolver and conflicts are reported as `CODEX_CONFIG_TARGET_CONFLICT` (which may also intersect with MCP/subagent overrides).

## Common diagnostics

- `HOOK_JSON_INVALID`
- `HOOK_MODE_INVALID`
- `HOOK_EVENTS_INVALID`
- `HOOK_EVENT_UNKNOWN`
- `HOOK_HANDLER_TYPE_INVALID`
- `HOOK_COMMAND_MISSING`
- `HOOK_TIMEOUT_INVALID`
- `HOOK_ENV_INVALID`
- `HOOK_STATUS_MESSAGE_INVALID`
- `HOOK_NOTIFY_EVENT_INVALID`
- `HOOK_NOTIFY_COMMAND_INVALID`
- `HOOK_EVENT_UNSUPPORTED`
- `HOOK_NOTIFY_CONFLICT`
- `HOOK_TARGET_CONFLICT`

## Practical recommendation

- Start with `mode: "best_effort"` while prototyping multi-provider behavior.
- Move to `mode: "strict"` once each enabled provider projection is intentional and validated.
