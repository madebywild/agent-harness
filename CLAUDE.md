This file provides guidance when working with code in this repository.

## Workflow

### Before starting work

1. List file names in `docs/` to understand available documentation.
2. Read any docs files relevant to the task at hand.

### Before finishing work

Run all quality gates in order:

```bash
pnpm check:write          # Biome lint + format with auto-fix
pnpm typecheck            # Type-check all packages
pnpm test                 # Unit tests (requires build)
pnpm test:e2e:containers  # E2E tests (requires Docker)
```

### After finishing work

1. List file names in `docs/` again.
2. Create, update, or delete any docs files affected by the changes.

### Code principles

- **DRY** — extract shared logic; never duplicate.
- **Low LOC** — delete dead code, prefer concise expressions, avoid boilerplate.
- **Simplicity** — the smallest change that solves the problem. No speculative abstractions.
- **Long-term maintainability** — clear names, narrow interfaces, minimal coupling.

## Build & Development Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (turbo, respects dependency order)
pnpm typecheck            # Type-check all packages
pnpm test                 # Run unit tests (requires build first; no Docker needed)
pnpm test:e2e:containers  # Run Docker-backed e2e tests (needs container runtime)
pnpm check:write          # Lint + format (Biome) with auto-fix
pnpm lint                 # Lint only (no fix)
pnpm format               # Format check only (no fix)
```

### Running a single test

Tests use Node's built-in test runner via `tsx`. From the toolkit package:

```bash
pnpm --filter @madebywild/agent-harness-framework exec tsx --test test/hooks.test.ts
```

### Watch mode during development

```bash
pnpm --filter @madebywild/agent-harness-framework watch
```

### CLI entrypoint (local dev)

After building: `packages/toolkit/dist/cli.js`

## Architecture

This is a **pnpm monorepo** with two packages, managed by Turborepo:

### `packages/manifest-schema` (`@madebywild/agent-harness-manifest`)

Zod schemas and TypeScript types for the `.harness/` workspace contract: manifest, lock, managed index, overrides, registries, and versioning constants. This is a dependency of the toolkit — changes here require rebuilding both packages.

Key files: `src/index.ts` (all schemas), `src/versioning.ts` (schema version constants).

### `packages/toolkit` (`@madebywild/agent-harness-framework`)

The main package containing the CLI and core engine. Key modules:

- **`src/cli.ts`** — CLI entrypoint; delegates to `src/cli/main.ts` which uses Commander.
- **`src/cli/`** — Command registration, contracts/types, handlers, adapters, and TUI renderers.
- **`src/engine.ts`** — `HarnessEngine` class: the orchestrator for init, plan, apply, watch, doctor, migrate, add/remove, registry operations, and provider enable/disable.
- **`src/loader.ts`** — Loads and validates canonical state: manifest, entities, source files, override sidecars, env var substitution.
- **`src/planner.ts`** — Builds a deterministic plan: drift detection, collision checks, create/update/delete operations, next lock/index computation.
- **`src/repository.ts`** — File I/O: read/write manifest, lock, managed index; atomic file operations.
- **`src/entity-registries.ts`** — Git registry clone, pull, entity materialization from remote registries.
- **`src/registry-validator.ts`** — Validates registry repo structure.
- **`src/hooks.ts`** — Canonical hook parsing and provider-specific projection.
- **`src/env.ts`** — env var placeholder loading and substitution.
- **`src/paths.ts`** — Path resolution for `.harness/` workspace layout.
- **`src/provider-adapters/`** — Per-provider rendering: `claude.ts`, `codex.ts`, `copilot.ts`, plus shared logic for MCP, subagents, hooks, and renderers.
- **`src/versioning/`** — `doctor.ts` (schema health checks), `migrate.ts` (schema migration), `registry.ts` (version registry).
- **`src/engine/`** — Engine sub-modules: `entities.ts` (add/remove/pull), `state.ts` (manifest read), `utils.ts` (config loading/validation).

### Pipeline flow

`loader.ts` → `planner.ts` → `engine.ts` (apply):

1. Validate workspace schema versions (doctor preflight)
2. Load manifest + canonical entities + override sidecars (with env substitution)
3. Render provider artifacts through adapters
4. Detect drift, collisions, creates/updates/deletes
5. `plan` returns diagnostics + operations; `apply` writes files + persists lock/index

## Code Style

- **TypeScript** targeting ES2022 with `NodeNext` module resolution. ESM only (`"type": "module"`).
- **Biome** for linting and formatting (2-space indent, double quotes, semicolons, 120 char line width).
- **Lefthook** pre-commit hooks auto-format and lint staged files; pre-push runs typecheck.
- Strict TypeScript: `noUncheckedIndexedAccess`, `noImplicitOverride`, full `strict` mode.
- **Git** — use [Conventional Commits](https://www.conventionalcommits.org/) format (e.g. `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Release

Both packages are versioned in lockstep. To release: bump `version` in both `packages/*/package.json` to the same semver, merge, then push a `vX.Y.Z` tag. CI publishes manifest-schema first, then framework.

## Node Version

Requires Node >= 22.

## Harness CLI (non-interactive)

The `harness` CLI manages the `.harness/` workspace — canonical entities, providers, and registries. All commands below run non-interactively. Append `--json` to any command for machine-readable output.

Global options: `--cwd <path>`, `--json`, `--no-interactive`.

### Initialization

```bash
npx harness init              # scaffold .harness/ workspace
npx harness init --force      # overwrite existing workspace
npx harness init --u-haul     # import legacy provider configs into .harness/
npx harness init --u-haul --u-haul-precedence codex  # override default precedence
```

### Providers

Enable or disable provider artifact generation. Supported providers: `claude`, `codex`, `copilot`.

```bash
npx harness provider enable claude
npx harness provider disable codex
```

### Entity management

Entities are the canonical source units. Each `add` command scaffolds a source file under `.harness/src/` and registers it in `manifest.json`. After adding or editing entities, run `npx harness apply` to generate provider artifacts.

#### Prompt (system prompt, at most one, id is always `system`)

```bash
npx harness add prompt                        # scaffold .harness/src/prompts/system.md
npx harness remove prompt system              # remove prompt entity + source
```

Source: `.harness/src/prompts/system.md` (markdown with optional YAML frontmatter).

#### Skills

```bash
npx harness add skill <skill-id>              # scaffold .harness/src/skills/<skill-id>/SKILL.md
npx harness remove skill <skill-id>
```

Source: `.harness/src/skills/<skill-id>/` directory; must contain `SKILL.md`. Additional files in the directory are included.

#### MCP server configs

```bash
npx harness add mcp <config-id>               # scaffold .harness/src/mcp/<config-id>.json
npx harness remove mcp <config-id>
```

Source: `.harness/src/mcp/<config-id>.json` (JSON object with server definitions).

#### Subagents

```bash
npx harness add subagent <subagent-id>        # scaffold .harness/src/subagents/<subagent-id>.md
npx harness remove subagent <subagent-id>
```

Source: `.harness/src/subagents/<subagent-id>.md` (markdown with required `name` and `description` in YAML frontmatter).

#### Lifecycle hooks

```bash
npx harness add hook <hook-id>                # scaffold .harness/src/hooks/<hook-id>.json
npx harness remove hook <hook-id>
```

Source: `.harness/src/hooks/<hook-id>.json`. Shape:

```json
{
  "mode": "strict",
  "events": {
    "<canonical-event>": [
      { "type": "command", "command": "...", "timeoutSec": 10 }
    ]
  }
}
```

`mode`: `"strict"` (default, errors on unsupported projections) or `"best_effort"` (skips unsupported).

#### Settings (provider-specific configuration)

```bash
npx harness add settings <provider>           # scaffold .harness/src/settings/<provider>.json
npx harness remove settings <provider>
```

Source: `.harness/src/settings/<provider>.json`. Provider id: `claude`, `codex`, or `copilot`.

#### Commands

```bash
npx harness add command <command-id>          # scaffold a command entity
npx harness remove command <command-id>
```

### Remove (generic)

```bash
npx harness remove <entity-type> <id>         # entity-type: prompt|skill|mcp|subagent|hook|settings|command
npx harness remove <entity-type> <id> --no-delete-source  # keep source files
```

### Plan, apply, and watch

```bash
npx harness plan                  # show planned operations (dry run)
npx harness apply                 # write all provider artifacts + update lock/index
npx harness watch                 # watch sources and auto-apply on changes
npx harness watch --debounce 500  # custom debounce in ms (default 250)
```

### Validation, doctor, and migration

```bash
npx harness validate              # validate manifest, ownership, and constraints
npx harness doctor                # check workspace schema version health
npx harness migrate               # migrate workspace schema to latest
npx harness migrate --dry-run     # preview migration without writing
```

### Registries

Registries are git repositories that supply shared entities across projects.

```bash
npx harness registry list
npx harness registry add <name> --git-url <url> [--ref <branch>] [--root <path>] [--token-env <VAR>]
npx harness registry remove <name>
npx harness registry default show
npx harness registry default set <name>
npx harness registry validate [--path <dir>] [--root <relative>]
```

Pull entities from registries into the workspace:

```bash
npx harness registry pull                                  # pull all
npx harness registry pull <entity-type> <id>               # pull specific entity
npx harness registry pull --registry <name>                # pull from specific registry
npx harness registry pull --force                          # overwrite locally modified imports
```

### Add from registry

Any `add` command accepts `--registry <name>` to scaffold from a registry instead of local defaults:

```bash
npx harness add skill my-skill --registry shared
npx harness add hook guard --registry shared
```

### Typical workflow

```bash
npx harness init
npx harness provider enable claude
npx harness add prompt
# edit .harness/src/prompts/system.md
npx harness add mcp my-server
# edit .harness/src/mcp/my-server.json
npx harness add hook guard
# edit .harness/src/hooks/guard.json
npx harness plan        # review
npx harness apply       # generate provider artifacts
```
