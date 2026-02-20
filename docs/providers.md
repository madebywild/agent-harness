# Supported Providers

This document describes the AI agent providers supported by `harness` and how they define their native configuration files.

## Overview

There is not yet a broadly adopted, "native" `.agents/` standard across major CLIs/IDEs. Each tool has its own config locations and file conventions. The `.agents/` pattern is being popularized mainly by unification tools like `dot-agents`, which centralize configs in `~/.agents/` and then symlink/export into each tool's native format.

`harness` takes a different approach: it maintains a single, canonical source of truth in `.harness/` and generates provider-native outputs directly into each tool's expected locations.

---

## Currently Supported Providers

### 1. OpenAI Codex

**Native Configuration Locations:**

- **Project-level prompt:** `AGENTS.md` (file-based discovery/override chain)
- **User/global config:** `~/.codex/config.toml` (for user-wide settings)
- **Skills directory:** `.codex/skills/<skill-id>/`
- **MCP config:** `.codex/config.toml`

**Agent-Harness Mapping:**
| Entity Type | Default Output Path | Format |
|-------------|---------------------|--------|
| Prompt | `AGENTS.md` | Markdown |
| Skills | `.codex/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.codex/config.toml` | TOML |

**MCP Configuration Structure:**

```toml
[mcp_servers]
[mcp_servers.server-name]
command = "node"
args = ["/path/to/server.js"]
```

**References:**

- [OpenAI Codex Config Reference](https://developers.openai.com/codex/config-reference)
- [OpenAI AGENTS.md Guide](https://developers.openai.com/codex/agents)

---

### 2. Anthropic Claude Code

**Native Configuration Locations:**

- **Project-level agents:** `.claude/agents/`
- **User/global agents:** `~/.claude/agents/`
- **CLI flag:** `--agents` (session-only override)
- **MCP config:** `.mcp.json` (project-level)

**Agent-Harness Mapping:**
| Entity Type | Default Output Path | Format |
|-------------|---------------------|--------|
| Prompt | `CLAUDE.md` | Markdown |
| Skills | `.claude/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.mcp.json` | JSON |

**MCP Configuration Structure:**

```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["/path/to/server.js"]
    }
  }
}
```

**References:**

- [Claude Code Settings](https://docs.claude.com/en/docs/claude-code/settings)

---

### 3. GitHub Copilot

**Native Configuration Locations:**

- **Project-level agents:** `.github/agents/` (Copilot CLI custom agents)
- **User/global agents:** `~/.config/copilot/agents/`
- **Repository instructions:** `.github/copilot-instructions.md`
- **MCP config:** `.vscode/mcp.json` (VS Code specific)

**Agent-Harness Mapping:**
| Entity Type | Default Output Path | Format |
|-------------|---------------------|--------|
| Prompt | `.github/copilot-instructions.md` | Markdown |
| Skills | `.github/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.vscode/mcp.json` | JSON |

**MCP Configuration Structure:**

```json
{
  "servers": {
    "server-name": {
      "command": "node",
      "args": ["/path/to/server.js"]
    }
  }
}
```

**Note:** The `servers` property (not `mcpServers`) is used for GitHub Copilot's MCP configuration.

**References:**

- [GitHub Copilot Repository Instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- [VS Code Copilot Agent Skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [VS Code Copilot MCP Servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)

---

## Provider Defaults Reference

```typescript
const PROVIDER_DEFAULTS = {
  codex: {
    promptTarget: "AGENTS.md",
    skillRoot: ".codex/skills",
    mcpTarget: ".codex/config.toml",
  },
  claude: {
    promptTarget: "CLAUDE.md",
    skillRoot: ".claude/skills",
    mcpTarget: ".mcp.json",
  },
  copilot: {
    promptTarget: ".github/copilot-instructions.md",
    skillRoot: ".github/skills",
    mcpTarget: ".vscode/mcp.json",
  },
};
```

---

## MCP Server Property Differences

Each provider uses a different root property name for MCP servers:

| Provider | JSON Property   | TOML Property |
| -------- | --------------- | ------------- |
| Codex    | N/A (TOML only) | `mcp_servers` |
| Claude   | `mcpServers`    | N/A           |
| Copilot  | `servers`       | N/A           |

This is important when writing custom MCP configurations or debugging output.

---

## Tools That Use Centralized `.agents/` Pattern

While `harness` generates directly to provider-native paths, some tools take a different approach:

### dot-agents (Unification Layer)

- **Purpose:** "Unify all your AI coding agents into a single `~/.agents/` directory"
- **Approach:** Symlink/reflect into tool-specific formats
- **Not natively supported** by any IDE/CLI; requires mapping

### dotagent (Singular `.agent/`)

- **Purpose:** Similar unification centered on `.agent/` directory structure
- **Features:** Converters for Claude Code, Copilot instructions, Cursor rules, etc.

---

## Future Provider Support

Potential providers for future versions:

| Tool     | Native Config Location               | Notes                              |
| -------- | ------------------------------------ | ---------------------------------- |
| Cursor   | `.cursor/rules/...`                  | Uses its own rule/config locations |
| OpenCode | `opencode.json` / config directories | JSON-based configuration           |
| Windsurf | TBD                                  | AI-powered IDE                     |
| Continue | `.continue/config.json`              | Open-source coding assistant       |

---

## Provider Enablement

Providers are enabled via the CLI:

```bash
harness provider enable codex
harness provider enable claude
harness provider enable copilot
```

Only enabled providers receive generated outputs. This allows teams to adopt providers incrementally.

---

## Customizing Output Paths

Each entity can override its default output path via sidecar files:

```yaml
# .harness/src/prompts/system.overrides.codex.yaml
version: 1
targetPath: "custom/path/AGENTS.md"
```

See the [architecture documentation](./architecture.md) for more details on overrides.
