# Agent Harness

![Cover](public/cover.webp)

[![Node Version](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![Package Manager](https://img.shields.io/badge/pnpm-10.2.0-blue)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/madebywild/agent-harness)

Unified AI agent configuration management for Codex, Claude, and Copilot. The Shadcn for agent harnesses.

Agent Harness is a TypeScript CLI tool and library that manages AI agent configurations (prompts, skills, MCP server configs, and subagents) from a single source of truth, generating provider-specific outputs for OpenAI Codex, Anthropic Claude Code, and GitHub Copilot.

Like [shadcn/ui](https://ui.shadcn.com/) does for UI components, Agent Harness gives you full ownership of your agent configuration. Pull shared entities from external git registries into your project as full source code — not as opaque library imports. You can inspect, modify, and version every file. The CLI manages the plumbing; you own the content.

## Features

### Unified agent config

- Single source of truth for all agent configurations in the `.harness/` directory
- Multi-provider support with simultaneous output generation for Codex, Claude, and Copilot
- System prompt management with provider-specific overrides
- Reusable skill management synchronized across providers
- Centralized MCP server configuration with merged outputs
- Subagent management with provider-specific rendering
- Lifecycle hook management (webhooks, scripts, notifications)
- Environment variable substitution via `{{PLACEHOLDER}}` syntax with `.env` file support
- Watch mode for automatic regeneration on file changes
- Strict file ownership with manifest-based integrity enforcement
- Explicit schema version management with `doctor` + `migrate`

### Shareable registries (the Shadcn model)

- Pull entities from external git registries directly into your project as full, editable source code
- No hidden abstractions — every pulled file lands in `.harness/src/` where you can inspect, modify, and commit it
- Per-entity registry provenance tracks where each entity originated
- Explicit `registry pull` workflow for refreshing imported entities on your terms
- Preset-based workspace bootstrapping with bundled, local, and registry-backed presets
- Teams can maintain a shared registry of battle-tested prompts, skills, hooks, and MCP configs that any project can adopt

## Quick Start

```bash
npm install --save-dev @madebywild/agent-harness-framework
npx harness init
```

Or start from a bundled preset:

```bash
npx harness init --preset starter
```

For first-run onboarding, you can ask harness to launch a specific agent CLI to author the shared prompt:

```bash
npx harness init --delegate claude
npx harness init --delegate codex
npx harness init --delegate copilot
```

This path auto-applies the bundled `delegate` preset, seeds `.harness/src/prompts/system.md` with one shared bootstrap prompt for all providers, and then launches the selected agent CLI so it can inspect the repository and finish setup through non-interactive `pnpm harness` or `npx harness` commands.

Then configure your workspace:

```bash
# Launch interactive TUI (default when TTY)
npx harness

# Enable providers
npx harness provider enable codex
npx harness provider enable claude
npx harness provider enable copilot

# Configure a git registry and set it as default
npx harness registry add corp --gitUrl git@github.com:acme/harness-registry.git --ref main
npx harness registry default set corp

# Add a system prompt
npx harness add prompt

# Add a skill
npx harness add skill my-skill

# Add MCP config
npx harness add mcp my-mcp

# Add subagent
npx harness add subagent researcher

# Add lifecycle hook
npx harness add hook my-hook

# List available presets
npx harness preset list

# Describe a preset
npx harness preset describe starter

# Apply a preset after init
npx harness preset apply starter

# Generate outputs
npx harness apply

# Watch for changes
npx harness watch
```

## Installation from source

For development of the library itself:

```bash
git clone <repo-url>
cd agent-harness
pnpm install
pnpm build
```

The CLI is available at `packages/toolkit/dist/cli.js`.

## CLI Commands

| Command                                                                 | Description                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npx harness init [--force] [--preset <id>] [--delegate <provider>]`    | Initialize `.harness/` structure, optionally apply a preset, and optionally launch delegated prompt authoring |
| `npx harness`                                                           | Interactive TUI on TTY, `plan` on non-TTY/CI                                                                  |
| `npx harness --interactive`                                             | Force interactive mode                                                                                        |
| `npx harness --version`                                                 | Print CLI version                                                                                             |
| `npx harness doctor`                                                    | Report schema version health and migration blockers                                                           |
| `npx harness migrate [--dryRun]`                                        | Upgrade schema files to latest supported version                                                              |
| `npx harness provider enable <id>`                                      | Enable a provider (codex/claude/copilot)                                                                      |
| `npx harness provider disable <id>`                                     | Disable a provider                                                                                            |
| `npx harness registry list`                                             | List configured registries                                                                                    |
| `npx harness registry add <name> --gitUrl <url> [--ref <branch>]`       | Add a Git registry entry                                                                                      |
| `npx harness registry remove <name>`                                    | Remove a configured registry                                                                                  |
| `npx harness registry default show/set <name>`                          | Show or set default registry                                                                                  |
| `npx harness registry pull [<type> <id>] [--registry <name>] [--force]` | Refresh imported entities                                                                                     |
| `npx harness registry validate [--path <path>]`                         | Validate a registry's structure                                                                               |
| `npx harness preset list [--registry <name>]`                           | List bundled, local, or registry presets                                                                      |
| `npx harness preset describe <id> [--registry <name>]`                  | Describe a preset                                                                                             |
| `npx harness preset apply <id> [--registry <name>]`                     | Materialize a preset into normal harness state                                                                |
| `npx harness add prompt [--registry <name>]`                            | Add system prompt entity                                                                                      |
| `npx harness add skill <id> [--registry <name>]`                        | Add a skill entity                                                                                            |
| `npx harness add mcp <id> [--registry <name>]`                          | Add an MCP config entity                                                                                      |
| `npx harness add subagent <id> [--registry <name>]`                     | Add a subagent entity                                                                                         |
| `npx harness add hook <id> [--registry <name>]`                         | Add a lifecycle hook entity                                                                                   |
| `npx harness remove <type> <id> [--no-delete-source]`                   | Remove an entity (deletes source by default)                                                                  |
| `npx harness validate`                                                  | Validate manifest and files                                                                                   |
| `npx harness plan`                                                      | Preview changes (dry-run)                                                                                     |
| `npx harness apply`                                                     | Generate provider outputs                                                                                     |
| `npx harness watch [--debounceMs]`                                      | Watch mode with auto-apply                                                                                    |

Global flags:

- `--cwd <path>`: run against a specific workspace root.
- `--json`: emit a stable machine-readable envelope (`schemaVersion: "1"`).
- `--interactive`: force interactive mode when available.
- `--no-interactive`: force command mode.

## Schema Version Policy

- Normal runtime commands (`plan`, `apply`, `validate`, `watch`, `add/remove`, `provider enable/disable`) require current schema versions.
- If any schema is outdated, run:
  1. `npx harness doctor`
  2. `npx harness migrate`
  3. `npx harness apply`
- If a workspace schema is newer than the installed CLI, commands fail safely with `*_VERSION_NEWER_THAN_CLI`; upgrade the CLI before proceeding.
- `npx harness migrate` creates a backup snapshot under `.harness/.backup/<timestamp>/` and writes files atomically.

## Project Structure

```
.harness/
├── manifest.json          # Entity + registry config
├── manifest.lock.json     # Generated state lock + registry provenance
├── managed-index.json     # Managed file index
├── .env                   # Per-workspace secrets (gitignored)
├── presets/               # Optional local preset packages
└── src/
    ├── prompts/
    │   └── system.md                    # System prompt
    │   ├── system.overrides.codex.yaml
    │   ├── system.overrides.claude.yaml
    │   └── system.overrides.copilot.yaml
    ├── skills/
    │   └── my-skill/
    │       ├── SKILL.md
    │       ├── OVERRIDES.codex.yaml
    │       ├── OVERRIDES.claude.yaml
    │       └── OVERRIDES.copilot.yaml
    ├── mcp/
        ├── my-mcp.json
        ├── my-mcp.overrides.codex.yaml
        ├── my-mcp.overrides.claude.yaml
        └── my-mcp.overrides.copilot.yaml
    ├── subagents/
    │   ├── researcher.md
    │   ├── researcher.overrides.codex.yaml
    │   ├── researcher.overrides.claude.yaml
    │   └── researcher.overrides.copilot.yaml
   ├── commands/
   │   └── fix-issue.md
    └── hooks/
        └── my-hook.json
.env.harness                   # Shared env parameters (optionally committed)
```

## Presets

Presets are bootstrap macros, not manifest entities.

- Bundled presets ship with the toolkit package.
- Local presets live under `.harness/presets/<id>/`.
- Registry presets live under `presets/<id>/` in a git registry.

The bundled `delegate` preset seeds one shared bootstrap prompt for Claude, Codex, and Copilot and enables all three providers. `init --delegate <provider>` uses that preset and then launches the selected agent CLI to replace the bootstrap content with the real project-specific prompt.

Applying a preset materializes normal harness state such as enabled providers, prompt/skill/subagent sources, settings, and commands. After that, the usual `validate`, `plan`, and `apply` workflow remains unchanged.

## Generated Outputs

| Entity    | Codex                                    | Claude                   | Copilot                           |
| --------- | ---------------------------------------- | ------------------------ | --------------------------------- |
| Prompt    | `AGENTS.md`                              | `.claude/CLAUDE.md`      | `.github/copilot-instructions.md` |
| Skills    | `.codex/skills/`                         | `.claude/skills/`        | `.github/skills/`                 |
| MCP       | `.codex/config.toml`                     | `.mcp.json`              | `.vscode/mcp.json`                |
| Subagents | `.codex/config.toml` (merged `agents.*`) | `.claude/agents/<id>.md` | `.github/agents/<id>.agent.md`    |
| Hooks     | `.codex/config.toml`                     | `.claude/settings.json`  | `.github/hooks/...`               |

## Monorepo Packages

### `@madebywild/agent-harness-manifest`

Zod schemas and TypeScript types for manifests, locks, and sidecars.

```typescript
import type {
  AgentsManifest,
  ProviderId,
  EntityRef,
} from "@madebywild/agent-harness-manifest";
```

### `@madebywild/agent-harness-framework`

The main toolkit with CLI and core engine.

```typescript
import { Planner, ProviderAdapter } from "@madebywild/agent-harness-framework";
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run type checks
pnpm typecheck

# Run tests
pnpm test

# Run containerized registry end-to-end tests
pnpm test:e2e:containers

# Lint and format
pnpm check:write

# Watch mode during development
pnpm --filter @madebywild/agent-harness-framework watch
```

## Release

This repository publishes two npm packages in lockstep:

- `@madebywild/agent-harness-manifest`
- `@madebywild/agent-harness-framework`

To release:

1. Bump `version` in both `packages/manifest-schema/package.json` and `packages/toolkit/package.json` to the same semver.
2. Merge the version bump PR.
3. Create and push a `vX.Y.Z` tag (e.g. `v0.2.0`). CI publishes manifest-schema first, then framework.

## Containerized E2E Tests

- `pnpm test` remains fast and does not require Docker.
- `pnpm test:e2e:containers` runs Docker-backed CLI end-to-end tests for remote git registries.
- A Docker-compatible container runtime is required for `pnpm test:e2e:containers`.
- The first run may be slower because it can pull the Gitea container image.

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed design documentation.

## Supported Providers

- **OpenAI Codex** - AGENTS.md and .codex/ configuration
- **Anthropic Claude Code** - CLAUDE.md and .claude/ configuration
- **GitHub Copilot** - .github/ copilot-instructions and skills

## License

MIT
