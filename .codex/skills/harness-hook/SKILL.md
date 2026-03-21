---
name: harness-hook
description: Create and manage lifecycle hook entities in the agent-harness workspace. Covers canonical event authoring, provider projection (Claude Code, GitHub Copilot, OpenAI Codex CLI), mode behavior, handler types, the full event/provider support matrix, copy-paste recipes, and common diagnostics.
---

# /harness-hook — Lifecycle Hook Authoring

A `hook` entity defines shell commands that run at specific agent lifecycle points. The canonical source lives in `.harness/src/hooks/<hook-id>.json`. When you run `npx harness apply`, harness projects that single source into each enabled provider's native config format.

---

## Quick start

```bash
npx harness add hook <hook-id>      # scaffold .harness/src/hooks/<hook-id>.json
# edit the file
npx harness apply                    # project to provider configs
```

---

## Canonical source shape

```json
{
  "mode": "strict",
  "events": {
    "<canonical-event>": [
      {
        "type": "command",
        "command": "node scripts/my-hook.js",
        "timeoutSec": 15
      }
    ]
  }
}
```

### `mode` field

| Value | Behavior |
|---|---|
| `"strict"` (default) | Any unsupported provider/event/handler combination fails with a diagnostic (e.g., `HOOK_EVENT_UNSUPPORTED`). Use when you want to be sure every enabled provider receives the hook. |
| `"best_effort"` | Unsupported combinations are silently skipped. Use while prototyping multi-provider setups. |

Recommendation: start with `"best_effort"` during development, switch to `"strict"` once all providers are intentionally configured.

---

## Canonical event list and provider support

| Canonical event | Claude Code | GitHub Copilot | OpenAI Codex |
|---|---|---|---|
| `session_start` | Yes (`SessionStart`) | Yes (`sessionStart`) | No |
| `session_end` | Yes (`SessionEnd`) | Yes (`sessionEnd`) | No |
| `prompt_submit` | Yes (`UserPromptSubmit`) | Yes (`userPromptSubmitted`) | No |
| `pre_tool_use` | Yes (`PreToolUse`) | Yes (`preToolUse`) | No |
| `permission_request` | Yes (`PermissionRequest`) | No | No |
| `post_tool_use` | Yes (`PostToolUse`) | Yes (`postToolUse`) | No |
| `post_tool_failure` | Yes (`PostToolUseFailure`) | No | No |
| `notification` | Yes (`Notification`) | No | No |
| `subagent_start` | Yes (`SubagentStart`) | No | No |
| `subagent_stop` | Yes (`SubagentStop`) | No | No |
| `stop` | Yes (`Stop`) | No | No |
| `stop_failure` | Yes (`StopFailure`) | No | No |
| `teammate_idle` | Yes (`TeammateIdle`) | No | No |
| `task_completed` | Yes (`TaskCompleted`) | No | No |
| `instructions_loaded` | Yes (`InstructionsLoaded`) | No | No |
| `config_change` | Yes (`ConfigChange`) | No | No |
| `worktree_create` | Yes (`WorktreeCreate`) | No | No |
| `worktree_remove` | Yes (`WorktreeRemove`) | No | No |
| `pre_compact` | Yes (`PreCompact`) | No | No |
| `post_compact` | Yes (`PostCompact`) | No | No |
| `elicitation` | Yes (`Elicitation`) | No | No |
| `elicitation_result` | Yes (`ElicitationResult`) | No | No |
| `error` | No | Yes (`errorOccurred`) | No |
| `turn_complete` | No | No | Yes (`notify`) |

---

## Provider projection details

### Claude Code

- **Output file:** `.claude/settings.json` (key: `hooks`)
- **Event names:** PascalCase (e.g., `pre_tool_use` → `PreToolUse`)
- **Handler types:** `command` only (harness canonical). Claude Code natively supports `command`, `http`, `prompt`, and `agent` handler types, but the harness canonical format only supports `command`.
- **Matcher:** supported on most events — filters by tool name, session source, exit reason, etc. Specify `"matcher"` on the handler; harness groups handlers with the same matcher under one entry.
- **Output shape:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "python3 scripts/check_bash_policy.py" }
        ]
      }
    ]
  }
}
```

- **Blocking events:** `PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `Elicitation`, `ElicitationResult`, `WorktreeCreate` — a handler exiting with code 2 blocks/denies the action.
- **Official docs:** https://code.claude.com/docs/en/hooks

### GitHub Copilot

- **Output file:** `.github/hooks/harness.generated.json` (top-level `version: 1`)
- **Event names:** camelCase (e.g., `pre_tool_use` → `preToolUse`, `prompt_submit` → `userPromptSubmitted`)
- **Supported canonical events:** `session_start`, `session_end`, `prompt_submit`, `pre_tool_use`, `post_tool_use`, `error`
- **Handler types:** `command` only
- **Matcher:** NOT supported — fails in `"strict"` mode, silently ignored in `"best_effort"` mode
- **Output shape:**

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "node scripts/pre_tool.js",
        "powershell": "node scripts/pre_tool.js",
        "timeoutSec": 15
      }
    ]
  }
}
```

- **Official docs:** https://docs.github.com/en/copilot/reference/hooks-configuration

### OpenAI Codex CLI

- **Output file:** `.codex/config.toml` (key: `notify = [...]`)
- **Supported canonical events:** `turn_complete` only
- **Handler types:** both `notify` and `command` handlers are accepted — both normalize to a TOML notify command array
- **Matcher:** NOT supported
- **Normalization rules:**
  - `notify` handler: `command` field used directly; string values are wrapped as `["sh", "-lc", "<command>"]`; arrays pass through unchanged
  - `command` handler: first available field among `command`, `bash`, `linux`, `osx`, `powershell`, `windows` is selected and wrapped the same way
- **Conflict rule:** only one notify command is allowed across all enabled hook entities. If two hooks produce different notify commands, `apply` fails with `HOOK_NOTIFY_CONFLICT`.
- **Output shape:**

```toml
notify = ["python3", "scripts/on_turn_complete.py"]
```

- **Official docs:** https://developers.openai.com/codex/config-reference

---

## Handler type reference

### `command` handler

```json
{
  "type": "command",
  "command": "node scripts/hook.js",
  "bash": "node scripts/hook.js",
  "linux": "node scripts/hook.js",
  "osx": "node scripts/hook.js",
  "windows": "node scripts\\hook.js",
  "powershell": "node scripts\\hook.js",
  "matcher": "Bash",
  "cwd": ".",
  "env": { "MY_VAR": "value" },
  "timeoutSec": 30
}
```

- At least one of `command`, `bash`, `linux`, `osx`, `windows`, `powershell` is required.
- `matcher` is Claude-only; ignored/errors for Copilot (strict mode error), not applicable for Codex.
- `env` values must all be strings.
- `timeoutSec` (or `timeout`) must be a positive number.

### `notify` handler (Codex only)

```json
{
  "type": "notify",
  "event": "agent-turn-complete",
  "command": ["python3", "scripts/on_turn_complete.py"]
}
```

- `event` defaults to `"agent-turn-complete"` when omitted — it is the only supported value.
- `command` must be a non-empty string or string array.
- `matcher` is not supported on `notify` handlers.

---

## Copy-paste recipes

### 1) Claude + Copilot pre-tool guard

Use `"strict"` mode because `pre_tool_use` is supported by both providers.

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

Outputs:
- Claude: `.claude/settings.json` `hooks.PreToolUse`
- Copilot: `.github/hooks/harness.generated.json` `hooks.preToolUse`

### 2) Claude matcher-based tool policy

Applies only when the `Bash` tool is invoked. Copilot does not support matcher — use a separate hook file or `"best_effort"` mode if Copilot is also enabled.

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

Claude output fragment:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "python3 scripts/check_bash_policy.py" }
        ]
      }
    ]
  }
}
```

### 3) Codex turn-complete notification

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

Codex output in `.codex/config.toml`:

```toml
notify = ["python3", "scripts/on_turn_complete.py"]
```

### 4) Cross-provider best_effort hook (all three providers)

Covers `pre_tool_use` for Claude/Copilot and `turn_complete` for Codex in one file. Unsupported combinations are skipped rather than failing.

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
- Claude: receives `PreToolUse`; `turn_complete` is skipped.
- Copilot: receives `preToolUse`; `turn_complete` is skipped.
- Codex: receives `notify`; `pre_tool_use` is skipped.

---

## Common diagnostics

| Code | Cause |
|---|---|
| `HOOK_JSON_INVALID` | Source file is not valid JSON |
| `HOOK_MODE_INVALID` | `mode` is not `"strict"` or `"best_effort"` |
| `HOOK_EVENTS_INVALID` | `events` key is missing or not an object |
| `HOOK_EVENT_UNKNOWN` | Event key is not in the canonical event list |
| `HOOK_HANDLER_TYPE_INVALID` | Handler `type` is not `"command"` or `"notify"` |
| `HOOK_COMMAND_MISSING` | `command` handler has no command field |
| `HOOK_TIMEOUT_INVALID` | `timeoutSec`/`timeout` is not a positive number |
| `HOOK_ENV_INVALID` | `env` is not a string-to-string map |
| `HOOK_NOTIFY_EVENT_INVALID` | `notify` handler `event` is not `"agent-turn-complete"` |
| `HOOK_NOTIFY_COMMAND_INVALID` | `notify` handler `command` is empty or wrong type |
| `HOOK_EVENT_UNSUPPORTED` | Event is not supported by the target provider (strict mode) |
| `HOOK_NOTIFY_CONFLICT` | Two Codex hooks produce different notify commands |
| `HOOK_TARGET_CONFLICT` | Multiple hook entities for one provider resolve to different output paths |

---

## CLI commands

```bash
npx harness add hook <hook-id>             # scaffold .harness/src/hooks/<hook-id>.json
npx harness apply                           # project all hooks to provider configs
npx harness plan                            # dry-run: preview operations without writing
npx harness remove hook <hook-id>           # remove hook entity and source file
npx harness remove hook <hook-id> --no-delete-source  # remove entity but keep source
npx harness validate                        # validate manifest, ownership, and constraints
```

---

## Output path overrides

To send a hook entity to a custom path for a specific provider, create a sidecar file:

`.harness/src/hooks/<hook-id>.overrides.<provider>.yaml`

```yaml
version: 1
targetPath: ".github/hooks/security.generated.json"
```

If multiple hook entities for the same provider resolve to different target paths, `apply` fails with `HOOK_TARGET_CONFLICT` (or `CODEX_CONFIG_TARGET_CONFLICT` for Codex).

---

## Official documentation

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- GitHub Copilot hooks configuration: https://docs.github.com/en/copilot/reference/hooks-configuration
- GitHub Copilot about hooks: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
