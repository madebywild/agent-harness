---
name: harness-mcp
description: Create and manage MCP server config entities in the agent-harness workspace.
---

# /harness-mcp

Use this skill to create, edit, and manage `mcp` entities in the agent-harness workspace. An `mcp` entity defines one or more MCP (Model Context Protocol) servers in a single JSON config file. When `harness apply` runs, all `mcp` config files are merged and rendered into each enabled provider's native format.

---

## What is an `mcp` entity?

An `mcp` entity is a JSON file under `.harness/src/mcp/<config-id>.json`. It contains a map of server definitions keyed by server ID. Multiple `mcp` config files are supported — harness merges them at apply time. If the same server ID appears in more than one file, harness rejects the plan with a collision error.

Source path: `.harness/src/mcp/<config-id>.json`

The file is a flat JSON object where each top-level key is a server ID and its value is the server definition. Any key-shape that does not use a reserved wrapper key (`servers` or `mcpServers`) is treated as a direct server map; files that happen to use those wrapper keys are unwrapped automatically before merging.

---

## Provider output mapping

| Field | Claude Code | OpenAI Codex CLI | GitHub Copilot |
|-------|-------------|------------------|----------------|
| Output file | `.mcp.json` | `.codex/config.toml` | `.vscode/mcp.json` |
| Root key | `mcpServers` | `[mcp_servers.<id>]` | `servers` |
| Format | JSON | TOML | JSON |

### Claude Code — `.mcp.json`

Root key: `mcpServers`. Each server entry supports:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run (stdio transport) |
| `args` | string[] | Arguments passed to the command |
| `env` | object | Environment variables forwarded to the server process |
| `type` | string | Transport: `stdio` (default), `sse`, or `http` |
| `url` | string | Endpoint URL (for `sse` / `http` transport) |

Project-scoped MCP servers live in `.mcp.json` at the repo root. This is the file harness writes.

Official docs: https://code.claude.com/docs/en/mcp

### OpenAI Codex CLI — `.codex/config.toml`

Section: `[mcp_servers.<id>]`. Fields rendered by harness are `command`, `args`, and `env`. The full field set supported by Codex config includes:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Launcher command for a stdio MCP server |
| `args` | string[] | Arguments passed to the command |
| `cwd` | string | Working directory for the server process |
| `env` | map | Environment variables forwarded to the server |
| `env_vars` | string[] | Additional env vars to whitelist |
| `url` | string | Endpoint for an HTTP/streamable MCP server |
| `bearer_token_env_var` | string | Env var name supplying the bearer token (HTTP) |
| `enabled` | boolean | Disable without removing (default: true) |
| `enabled_tools` | string[] | Allowlist of tool names exposed by this server |
| `disabled_tools` | string[] | Denylist applied after `enabled_tools` |
| `required` | boolean | Fail startup if server cannot initialize |
| `startup_timeout_sec` | number | Override default 10 s startup timeout |
| `tool_timeout_sec` | number | Override default 60 s per-tool timeout |

Official docs: https://developers.openai.com/codex/config-reference

### GitHub Copilot — `.vscode/mcp.json`

Root key: `servers`. Each server entry supports:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Transport: `stdio` (default), `sse`, or `http` |
| `command` | string | Executable to run (stdio) |
| `args` | string[] | Arguments passed to the command |
| `env` | object | Environment variables |
| `url` | string | Remote server endpoint (sse / http) |
| `inputs` | object | Input variable definitions for sensitive data |

Official docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers

---

## Canonical source format

The harness source file is a plain JSON object. Use one server-ID key per server you want to register:

```json
{
  "<server-id>": {
    "command": "...",
    "args": ["..."],
    "env": {
      "VAR_NAME": "value"
    }
  }
}
```

You may define as many servers as needed in one file, or split them across multiple `mcp` entity files. Harness merges all files before rendering — server IDs must be unique across all files.

---

## Harness CLI commands

```bash
# Scaffold a new mcp config file and register it in the manifest
npx harness add mcp <config-id>

# After editing the source file, generate provider artifacts
npx harness apply

# Preview what apply will do (no writes)
npx harness plan

# Remove an mcp entity and its source file
npx harness remove mcp <config-id>

# Remove entity but keep the source file
npx harness remove mcp <config-id> --no-delete-source
```

---

## Copy-paste example

`.harness/src/mcp/servers.json` — a filesystem server and a Postgres server:

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    "env": {}
  },
  "postgres": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-postgres"],
    "env": {
      "POSTGRES_CONNECTION_STRING": "${POSTGRES_CONNECTION_STRING}"
    }
  }
}
```

After running `npx harness apply`, harness writes:

**`.mcp.json`** (Claude Code):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "actual-value-from-env"
      }
    }
  }
}
```

**`.codex/config.toml`** (Codex CLI):
```toml
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]

[mcp_servers.postgres]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-postgres"]

[mcp_servers.postgres.env]
POSTGRES_CONNECTION_STRING = "actual-value-from-env"
```

**`.vscode/mcp.json`** (GitHub Copilot):
```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "actual-value-from-env"
      }
    }
  }
}
```

---

## Environment variable substitution

Use `${ENV_VAR_NAME}` placeholders anywhere in the JSON values. Harness substitutes them at apply time using the process environment. This keeps secrets out of source-controlled files.

```json
{
  "my-api-server": {
    "command": "npx",
    "args": ["-y", "my-mcp-server"],
    "env": {
      "API_KEY": "${MY_API_KEY}",
      "BASE_URL": "${MY_API_BASE_URL}"
    }
  }
}
```

If a referenced variable is not set in the environment, harness will error during apply.

---

## Typical workflow

```bash
# 1. Enable providers (once per project)
npx harness provider enable claude
npx harness provider enable codex
npx harness provider enable copilot

# 2. Scaffold the config file
npx harness add mcp servers

# 3. Edit .harness/src/mcp/servers.json with your server definitions

# 4. Review the plan
npx harness plan

# 5. Write provider artifacts
npx harness apply
```

---

## Official documentation

- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code Settings: https://code.claude.com/docs/en/settings
- OpenAI Codex Config Reference: https://developers.openai.com/codex/config-reference
- GitHub Copilot MCP (VS Code): https://code.visualstudio.com/docs/copilot/chat/mcp-servers
