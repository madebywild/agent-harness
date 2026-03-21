---
name: harness-settings
description: Configure provider-specific settings (permissions, model, features) for Claude Code, OpenAI Codex CLI, and GitHub Copilot using the harness settings entity.
---

# /harness-settings

Manage provider-specific configuration — permissions, model selection, sandboxing, environment variables, and feature flags — through the harness `settings` entity.

## What is the settings entity?

The `settings` entity lets you commit provider-specific configuration into `.harness/src/settings/` and have harness write it to the correct provider config file on `apply`. Unlike entities such as `prompt`, `skill`, or `mcp`, settings are inherently per-provider: each file targets exactly one provider and is written to that provider's native config location.

**Source files:**

| Provider | Source | Output |
|---|---|---|
| `claude` | `.harness/src/settings/claude.json` | `.claude/settings.json` |
| `codex` | `.harness/src/settings/codex.json` | `.codex/config.toml` (merged with MCP/subagent/hook state) |
| `copilot` | `.harness/src/settings/copilot.json` | `.github/copilot-settings.json` |

Per-provider override sidecars (`.overrides.<provider>.yaml`) are not applicable to settings entities — the file is already provider-specific.

**Important:** The `hooks` key in `.claude/settings.json` is managed by the `hook` entity. Do not set `hooks` inside `claude.json` — it will be merged in from your hook sources at apply time. Similarly, for Codex, `mcp_servers`, `agents`, and `notify` entries are merged in from their respective entity types; set only the keys your settings entity owns.

---

## CLI commands

```bash
# Scaffold a settings source file
npx harness add settings claude
npx harness add settings codex
npx harness add settings copilot

# Preview what will be written
npx harness plan

# Write settings to provider config files
npx harness apply

# Remove a settings entity (keeps source by default)
npx harness remove settings claude
npx harness remove settings claude --no-delete-source
```

---

## Claude Code (`claude.json`)

Written to `.claude/settings.json`. This is the project-scoped settings file committed to git and shared with your team.

### Common fields

| Key | Type | Description |
|---|---|---|
| `permissions` | object | Tool allow/deny/ask rules — see below |
| `model` | string | Override default model, e.g. `"claude-sonnet-4-6"` |
| `apiKeyHelper` | string | Shell script path to generate an auth token (`X-Api-Key` / `Authorization: Bearer`) |
| `env` | object | Environment variables injected into every session |
| `cleanupPeriodDays` | number | Delete sessions inactive longer than N days (default: 30; `0` disables persistence) |
| `autoUpdatesChannel` | string | `"stable"` or `"latest"` (default) |
| `includeGitInstructions` | boolean | Include built-in commit/PR workflow instructions in system prompt (default: `true`) |
| `companyAnnouncements` | string[] | Messages shown to users at startup |
| `attribution` | object | Customize git commit/PR attribution strings |
| `language` | string | Claude's preferred response language, e.g. `"japanese"` |
| `effortLevel` | string | Persist effort level across sessions: `"low"`, `"medium"`, or `"high"` |
| `alwaysThinkingEnabled` | boolean | Enable extended thinking by default |
| `outputStyle` | string | Configure an output style preset |
| `agent` | string | Run the main thread as a named subagent |
| `enableAllProjectMcpServers` | boolean | Auto-approve all MCP servers in `.mcp.json` |
| `enabledMcpjsonServers` | string[] | Approve specific MCP servers from `.mcp.json` |
| `disabledMcpjsonServers` | string[] | Reject specific MCP servers from `.mcp.json` |
| `sandbox` | object | Advanced sandboxing — see below |
| `worktree` | object | Worktree symlink and sparse-checkout settings |
| `statusLine` | object | Custom status line command |
| `plansDirectory` | string | Override where plan files are stored |

### Permissions

The `permissions` object lives inside the `settings.json` root. Rules are evaluated: deny first, then ask, then allow. First match wins.

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Bash(npm run *)", "Bash(git *)", "Read(~/.zshrc)"],
    "ask":   ["Bash(git push *)"],
    "deny":  ["Bash(curl *)", "Read(./.env)", "Read(./secrets/**)"],
    "additionalDirectories": ["../docs/"]
  }
}
```

**`defaultMode` options:**

| Value | Behavior |
|---|---|
| `"default"` | Normal interactive permission prompts |
| `"acceptEdits"` | Auto-accept file edits; prompt for other tools |
| `"bypassPermissions"` | Skip all permission prompts (non-interactive CI use) |

**Rule syntax:** `Tool` or `Tool(specifier)`. Examples:
- `"Bash"` — all Bash commands
- `"Bash(npm run *)"` — commands starting with `npm run`
- `"Read(./.env)"` — reading the `.env` file
- `"WebFetch(domain:example.com)"` — fetches to example.com
- `"mcp__*"` — all MCP tool calls

**Managed-only permission keys** (for enterprise `managed-settings.json`):
- `disableBypassPermissionsMode: "disable"` — prevent `--dangerously-skip-permissions`
- `allowManagedPermissionRulesOnly: true` — block user/project allow/deny rules
- `allowManagedMcpServersOnly: true` — enforce MCP allowlist from managed settings

### Sandbox settings

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker", "git"],
    "filesystem": {
      "allowWrite": ["/tmp/build", "~/.kube"],
      "denyRead":   ["~/.aws/credentials"]
    },
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"]
    }
  }
}
```

### Copy-paste example

This is a typical project-level `claude.json` for a team repo:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "claude-sonnet-4-6",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(npm run *)",
      "Bash(pnpm *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git status)",
      "Read",
      "Edit",
      "Write",
      "mcp__*"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(git commit *)"
    ],
    "deny": [
      "Bash(curl *)",
      "Bash(wget *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)"
    ]
  },
  "includeGitInstructions": true,
  "autoUpdatesChannel": "stable",
  "companyAnnouncements": [
    "Run pnpm check:write before committing."
  ]
}
```

---

## OpenAI Codex CLI (`codex.json`)

Written to `.codex/config.toml` and merged with MCP server entries, agent definitions, and hook `notify` commands from their respective entities. Only set the keys your settings entity owns — do not duplicate `mcp_servers`, `agents.<name>`, or `notify`.

### Common fields

| Key | Type | Description |
|---|---|---|
| `model` | string | Model to use, e.g. `"gpt-5.4"` |
| `model_provider` | string | Provider ID (default: `"openai"`) |
| `model_reasoning_effort` | string | `"minimal"`, `"low"`, `"medium"`, `"high"`, or `"xhigh"` |
| `model_reasoning_summary` | string | `"auto"`, `"concise"`, `"detailed"`, or `"none"` |
| `approval_policy` | string/object | `"untrusted"`, `"on-request"`, `"never"`, or granular object |
| `sandbox_mode` | string | `"read-only"` (default), `"workspace-write"`, `"danger-full-access"` |
| `web_search` | string | `"disabled"`, `"cached"` (default), or `"live"` |
| `service_tier` | string | `"flex"` or `"fast"` |
| `developer_instructions` | string | Injected session guidance |
| `history.persistence` | string | `"save-all"` or `"none"` |
| `features.shell_tool` | boolean | Enable/disable default command execution tool |
| `features.multi_agent` | boolean | Enable agent collaboration tools |
| `features.web_search` | boolean | Toggle web search |
| `features.fast_mode` | boolean | Enable fast mode feature flag |
| `agents.max_threads` | number | Concurrent thread limit (default: 6) |
| `agents.max_depth` | number | Max nesting depth for spawned threads |

### Copy-paste example

```json
{
  "model": "gpt-5.4",
  "model_reasoning_effort": "medium",
  "approval_policy": "on-request",
  "sandbox_mode": "workspace-write",
  "web_search": "cached",
  "features": {
    "shell_tool": true,
    "multi_agent": true
  },
  "agents": {
    "max_threads": 4
  }
}
```

---

## GitHub Copilot (`copilot.json`)

GitHub Copilot's primary customization surface is `.github/copilot-instructions.md` (managed by the `prompt` entity) and `.vscode/mcp.json` (managed by the `mcp` entity). The `copilot.json` settings entity handles remaining provider-level configuration written to `.github/copilot-settings.json`.

Copilot's custom instructions, agent skills, and MCP servers are all managed by their respective harness entities — not by the settings entity.

---

## Entity interactions

| Concern | Entity to use |
|---|---|
| Claude permissions, model, env vars | `settings claude` |
| Claude lifecycle hooks | `hook` |
| Claude MCP servers | `mcp` |
| Claude subagents | `subagent` |
| Codex model, approval policy, sandbox | `settings codex` |
| Codex MCP servers | `mcp` |
| Codex hook notifications | `hook` |
| Copilot system instructions | `prompt` |
| Copilot MCP servers | `mcp` |

---

## Typical workflow

```bash
npx harness add settings claude
# Edit .harness/src/settings/claude.json
npx harness plan          # verify what will be written
npx harness apply         # write .claude/settings.json
```

To manage settings alongside other entities in a single apply:

```bash
npx harness add settings claude
npx harness add mcp my-server
npx harness add hook guard
# Edit source files
npx harness apply         # writes all provider artifacts at once
```

---

## Official documentation

- Claude Code settings reference: https://code.claude.com/docs/en/settings
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Claude Code sandboxing: https://code.claude.com/docs/en/sandboxing
- OpenAI Codex CLI config reference: https://developers.openai.com/codex/config-reference
- OpenAI Codex CLI sample config: https://developers.openai.com/codex/config-sample
- GitHub Copilot custom instructions: https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
- GitHub Copilot VS Code settings: https://code.visualstudio.com/docs/copilot/reference/copilot-settings
