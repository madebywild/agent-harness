# @madebywild/agent-harness-framework

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/madebywild/agent-harness)

CLI and engine for [Agent Harness](https://github.com/madebywild/agent-harness) — unified AI agent configuration management for Claude Code, GitHub Copilot, and OpenAI Codex. The Shadcn for agent harnesses.

Agent Harness manages agent configurations (system prompts, skills, MCP servers, subagents, and lifecycle hooks) from a single source of truth in a `.harness/` directory and generates provider-specific outputs for each enabled provider. Like [shadcn/ui](https://ui.shadcn.com/) does for UI components, entities can be pulled from external git registries as full, editable source code — no opaque library imports, complete transparency and ownership.

## Installation

```bash
npm install @madebywild/agent-harness-framework
# or
pnpm add @madebywild/agent-harness-framework
```

## Quick start

```bash
npx harness init
npx harness add prompt
npx harness add skill reviewer
npx harness add mcp playwright
npx harness provider enable claude
npx harness apply
```

Or simply run `npx harness` with no arguments to launch the interactive TUI.

### Migrating existing provider configs

Already have `CLAUDE.md`, `AGENTS.md`, or other provider-specific files? U-Haul imports them into canonical `.harness/src/` entities:

```bash
npx harness init --u-haul
npx harness init --u-haul --u-haul-precedence codex  # override default precedence (claude > codex > copilot)
```

U-Haul detects legacy assets across all three providers, resolves conflicts via provider precedence, materializes canonical entities, auto-enables contributing providers, removes imported legacy files, and runs `apply`. The interactive TUI also offers U-Haul automatically when it detects legacy provider files.

## Interactive mode (TUI)

The primary way to use Agent Harness is through its interactive terminal UI. Run `npx harness` with no arguments (or with `--interactive`) and you'll get a menu-driven interface that walks you through every operation — initializing workspaces, adding entities, enabling providers, and applying changes — with prompts, validation, and confirmation at each step.

```bash
npx harness              # launch interactive mode
npx harness --interactive # force interactive mode (e.g. in scripts)
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
npx harness init [--force]                                   # Initialize .harness/ workspace
npx harness init --u-haul [--u-haul-precedence <provider>]   # Import legacy provider configs into .harness/
npx harness plan                                             # Preview planned file operations (default command)
npx harness apply                                            # Generate provider outputs and update lock
npx harness validate                                         # Validate manifest, ownership, and constraints
npx harness watch [--debounceMs]                             # Watch .harness/src/ and auto-apply on changes
```

### Entity management

Five entity types are supported:

| Type | Source format | Description |
|---|---|---|
| **prompt** | Markdown | System prompt shared across providers |
| **skill** | Directory (Markdown + files) | Reusable tool/skill definitions (also importable from [skills.sh](https://skills.sh)) |
| **mcp** | JSON | MCP server configurations |
| **subagent** | Markdown with frontmatter | Sub-agent definitions with tools/model config |
| **hook** | JSON | Lifecycle hooks (webhooks, scripts, notifications) |

All entity source files and override sidecars support `{{PLACEHOLDER}}` syntax for injecting secrets and context-dependent values at apply time. See the [Environment Variables Guide](../../docs/environment-variables.md) for details.

```bash
npx harness add prompt                     # Add the system prompt
npx harness add skill <id>                 # Add a skill
npx harness add mcp <id>                   # Add an MCP server config
npx harness add subagent <id>              # Add a subagent
npx harness add hook <id>                  # Add a lifecycle hook
npx harness remove <entityType> <id>       # Remove an entity (deletes source by default)
```

### Third-party skills (skills.sh)

Search and import community skills from [skills.sh](https://skills.sh) with built-in audit gating:

```bash
npx harness skill find <query>                                          # Search third-party skills
npx harness skill import <source> --skill <id> [--as <id>] [--replace]  # Import into .harness/src/skills
```

Imported skills go through a security audit pipeline (gen, socket, snyk). Use `--allow-unsafe` to override audit failures or `--allow-unaudited` to import skills without published audits.

### Provider management

```bash
npx harness provider enable <provider>     # Enable a provider (claude, copilot, codex)
npx harness provider disable <provider>    # Disable a provider
```

### Registry management

Registries are shared collections of entities that can be pulled into any workspace via git — like Shadcn, entities are copied as full source code into your project, not installed as opaque dependencies.

```bash
npx harness registry list                                   # List configured registries
npx harness registry add <name> --gitUrl <url> [--ref main] # Add a git registry
npx harness registry remove <name>                          # Remove a registry
npx harness registry default show                           # Show the default registry
npx harness registry default set <name>                     # Set the default registry
npx harness registry pull [entityType] [id] [--force]       # Pull entities from a registry
npx harness registry validate [--path <path>]               # Validate a registry's structure
```

### Health and migration

```bash
npx harness doctor               # Inspect workspace schema version health
npx harness migrate [--dryRun]   # Migrate workspace to latest schema version
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
  .env                       # Per-workspace secrets (gitignored)
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
.env.harness                 # Shared env parameters (optionally committed)
```

## Programmatic API

The framework can also be used as a library:

```ts
import { createEngine } from "@madebywild/agent-harness-framework";

const engine = createEngine({ cwd: process.cwd() });
const planResult = await engine.plan();
const applyResult = await engine.apply();
```

The env module is also exported for standalone use:

```ts
import { parseEnvFile, loadEnvVars, substituteEnvVars } from "@madebywild/agent-harness-framework";
```

## License

[MIT](./LICENSE)
