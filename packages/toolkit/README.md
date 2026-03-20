# @madebywild/agent-harness-framework

CLI and engine for [Agent Harness](https://github.com/madebywild/agent-harness) — unified AI agent configuration management for Codex, Claude, and Copilot.

Agent Harness manages AI agent configurations (prompts, skills, MCP server configs, and subagents) from a single source of truth in the `.harness/` directory, generating provider-specific outputs for OpenAI Codex, Anthropic Claude Code, and GitHub Copilot.

## Installation

```bash
pnpm add @madebywild/agent-harness-framework
```

## CLI

```bash
harness init          # Initialize harness in a project
harness add prompt    # Add a system prompt
harness add skill     # Add a skill
harness apply         # Generate provider outputs
harness watch         # Watch for changes and regenerate
harness doctor        # Check configuration health
```

## License

MIT
