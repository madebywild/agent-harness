# @madebywild/agent-harness-framework

CLI and engine for [Agent Harness](https://github.com/madebywild/agent-harness) — unified AI agent configuration management for Claude Code, GitHub Copilot, and OpenAI Codex.

Agent Harness manages agent configurations (system prompts, skills, MCP servers, subagents, and lifecycle hooks) from a single source of truth in a `.harness/` directory and generates provider-specific outputs for each enabled provider.

## Installation

```bash
npm install @madebywild/agent-harness-framework
# or
pnpm add @madebywild/agent-harness-framework
```

## Quick start

```bash
harness init
harness add prompt
harness add skill reviewer
harness add mcp playwright
harness provider enable claude
harness apply
```

Or simply run `harness` with no arguments to launch the interactive TUI.

## Interactive mode (TUI)

The primary way to use Agent Harness is through its interactive terminal UI. Run `harness` with no arguments (or with `--interactive`) and you'll get a menu-driven interface that walks you through every operation — initializing workspaces, adding entities, enabling providers, and applying changes — with prompts, validation, and confirmation at each step.

```bash
harness              # launch interactive mode
harness --interactive # force interactive mode (e.g. in scripts)
```

Interactive mode is activated automatically in TTY environments and disabled in CI. Use `--no-interactive` to suppress it.

## Direct commands

All operations are also available as direct CLI commands, useful for CI pipelines, scripting, and AI agents.

### Global flags

| Flag | Description |
|---|---|
| `--cwd <path>` | Set working directory |
| `--json` | Emit machine-readable JSON output |
| `--interactive` | Force interactive mode |
| `--no-interactive` | Disable interactive mode |

### Workspace lifecycle

```bash
harness init [--force]       # Initialize .harness/ workspace
harness plan                 # Preview planned file operations (default command)
harness apply                # Generate provider outputs and update lock
harness validate             # Validate manifest, ownership, and constraints
harness watch [--debounceMs] # Watch .harness/src/ and auto-apply on changes
```

### Entity management

Five entity types are supported:

| Type | Source format | Description |
|---|---|---|
| **prompt** | Markdown | System prompt shared across providers |
| **skill** | Directory (Markdown + files) | Reusable tool/skill definitions |
| **mcp** | JSON | MCP server configurations |
| **subagent** | Markdown with frontmatter | Sub-agent definitions with tools/model config |
| **hook** | JSON | Lifecycle hooks (webhooks, scripts, notifications) |

```bash
harness add prompt                     # Add the system prompt
harness add skill <id>                 # Add a skill
harness add mcp <id>                   # Add an MCP server config
harness add subagent <id>              # Add a subagent
harness add hook <id>                  # Add a lifecycle hook
harness remove <entityType> <id>       # Remove an entity (deletes source by default)
```

### Provider management

```bash
harness provider enable <provider>     # Enable a provider (claude, copilot, codex)
harness provider disable <provider>    # Disable a provider
```

### Registry management

Registries are shared collections of entities that can be imported into any workspace via git.

```bash
harness registry list                                   # List configured registries
harness registry add <name> --gitUrl <url> [--ref main] # Add a git registry
harness registry remove <name>                          # Remove a registry
harness registry default show                           # Show the default registry
harness registry default set <name>                     # Set the default registry
harness registry pull [entityType] [id] [--force]       # Pull entities from a registry
harness registry validate [--path <path>]               # Validate a registry's structure
```

### Health and migration

```bash
harness doctor               # Inspect workspace schema version health
harness migrate [--dryRun]   # Migrate workspace to latest schema version
```

## Provider outputs

Each enabled provider gets its own set of generated files:

| | Claude | Copilot | Codex |
|---|---|---|---|
| **Prompt** | `.claude/CLAUDE.md` | `.github/copilot-instructions.md` | `AGENTS.md` |
| **Skills** | `.claude/skills/<id>/` | `.github/skills/<id>/` | `.codex/skills/<id>/` |
| **MCP** | `.mcp.json` | `.vscode/mcp.json` | `.codex/config.toml` |
| **Subagents** | `.claude/agents/<id>.md` | `.github/agents/<id>.agent.md` | `.codex/config.toml` |
| **Hooks** | `.claude/settings.json` | `.github/hooks/...` | `.codex/config.toml` |

Each entity can have per-provider overrides via `.overrides.<provider>.yml` sidecar files, allowing you to customize target paths, enable/disable per provider, or set provider-specific options (model, tools, handoffs).

## Workspace structure

```
.harness/
  manifest.json              # Source of truth: entities, providers, registries
  manifest.lock.json         # Generated state and fingerprints
  managed-index.json         # Tracks managed source and output files
  src/
    prompts/
      system.md              # System prompt
    skills/
      <id>/
        SKILL.md             # Skill definition + supporting files
    mcp/
      <id>.json              # MCP server config
    subagents/
      <id>.md                # Subagent definition
    hooks/
      <id>.json              # Lifecycle hook definition
```

## Programmatic API

The framework can also be used as a library:

```ts
import { createEngine } from "@madebywild/agent-harness-framework";

const engine = createEngine({ cwd: process.cwd() });
const planResult = await engine.plan();
const applyResult = await engine.apply();
```

## License

[MIT](./LICENSE)
