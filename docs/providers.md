# Supported Providers

This document describes provider-native config locations and how `harness` maps canonical entities to those formats.

## Overview

`harness` keeps one canonical source of truth in `.harness/` and generates provider-native outputs into expected project paths.

Supported providers:

- OpenAI Codex (`codex`)
- Anthropic Claude Code (`claude`)
- GitHub Copilot (`copilot`)

## Canonical entity coverage

| Entity Type | Codex | Claude | Copilot |
| --- | --- | --- | --- |
| `prompt` | Yes | Yes | Yes |
| `skill` | Yes | Yes | Yes |
| `mcp_config` | Yes | Yes | Yes |
| `subagent` | Yes | Yes | Yes |
| `hook` | Partial (`notify` projection) | Yes | Yes |

Authoring examples: [Hook Authoring Guide](./hook-authoring.md)

## 1. OpenAI Codex

### Native configuration locations

- Prompt: `AGENTS.md`
- Skills: `.codex/skills/<skill-id>/`
- Provider state: `.codex/config.toml`

### Harness mapping

| Entity Type | Default Output Path | Format |
| --- | --- | --- |
| Prompt | `AGENTS.md` | Markdown |
| Skills | `.codex/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.codex/config.toml` (`[mcp_servers.<id>]`) | TOML |
| Subagents | `.codex/config.toml` (`[agents.<id>]`) | TOML |
| Hooks | `.codex/config.toml` (`notify = [...]`) | TOML |

### Hook notes

- Codex projection always accepts canonical `turn_complete`; strict mode only controls whether other unsupported events/handlers cause errors.
- Hook handlers can be `notify` or `command`; both normalize into `notify` command array.
- Multiple distinct notify commands across enabled hooks fail with `HOOK_NOTIFY_CONFLICT`.

## 2. Anthropic Claude Code

### Native configuration locations

- Prompt: `CLAUDE.md`
- Skills: `.claude/skills/<skill-id>/`
- Subagents: `.claude/agents/<id>.md`
- MCP: `.mcp.json`
- Hooks/settings: `.claude/settings.json`

### Harness mapping

| Entity Type | Default Output Path | Format |
| --- | --- | --- |
| Prompt | `CLAUDE.md` | Markdown |
| Skills | `.claude/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.mcp.json` (`mcpServers`) | JSON |
| Subagents | `.claude/agents/<id>.md` | Markdown |
| Hooks | `.claude/settings.json` (`hooks`) | JSON |

### Hook notes

- Uses Claude lifecycle event names (for example `PreToolUse`, `PostToolUse`, `SessionStart`).
- Supports canonical `command` hook handlers.
- Matcher support is event-dependent; invalid matcher usage fails in strict mode.

## 3. GitHub Copilot

### Native configuration locations

- Prompt: `.github/copilot-instructions.md`
- Skills: `.github/skills/<skill-id>/`
- Subagents: `.github/agents/<id>.agent.md`
- MCP: `.vscode/mcp.json`
- Hooks: `.github/hooks/harness.generated.json`

### Harness mapping

| Entity Type | Default Output Path | Format |
| --- | --- | --- |
| Prompt | `.github/copilot-instructions.md` | Markdown |
| Skills | `.github/skills/<skill-id>/` | Markdown/JSON |
| MCP Config | `.vscode/mcp.json` (`servers`) | JSON |
| Subagents | `.github/agents/<id>.agent.md` | Markdown |
| Hooks | `.github/hooks/harness.generated.json` (`version: 1`) | JSON |

### Hook notes

- Uses Copilot CLI event names (for example `preToolUse`, `postToolUse`, `sessionStart`).
- Supports canonical `command` handlers only.
- Matcher is unsupported for Copilot projection and fails in strict mode.

## Provider defaults

```ts
const PROVIDER_DEFAULTS = {
  codex: {
    promptTarget: "AGENTS.md",
    skillRoot: ".codex/skills",
    mcpTarget: ".codex/config.toml",
    hookTarget: ".codex/config.toml",
  },
  claude: {
    promptTarget: "CLAUDE.md",
    skillRoot: ".claude/skills",
    mcpTarget: ".mcp.json",
    hookTarget: ".claude/settings.json",
  },
  copilot: {
    promptTarget: ".github/copilot-instructions.md",
    skillRoot: ".github/skills",
    mcpTarget: ".vscode/mcp.json",
    hookTarget: ".github/hooks/harness.generated.json",
  },
};
```

## MCP server root key differences

| Provider | Root key |
| --- | --- |
| Codex | `mcp_servers` (TOML tables) |
| Claude | `mcpServers` |
| Copilot | `servers` |

## Provider enablement

```bash
npx harness provider enable codex
npx harness provider enable claude
npx harness provider enable copilot
```

Only enabled providers generate artifacts.

## Output path overrides

Each entity can override provider output path using sidecar override YAML:

```yaml
version: 1
targetPath: "custom/path/output.file"
```

For hook entities the default sidecar path is:

- `.harness/src/hooks/<id>.overrides.<provider>.yaml`

## References

- [OpenAI Codex Config Reference](https://developers.openai.com/codex/config-reference)
- [OpenAI AGENTS.md Guide](https://developers.openai.com/codex/agents)
- [Claude Code Settings](https://docs.claude.com/en/docs/claude-code/settings)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [GitHub Copilot Hooks Configuration](https://docs.github.com/en/copilot/reference/hooks-configuration)
- [VS Code Copilot Hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)
