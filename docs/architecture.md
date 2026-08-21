# Architecture

This document describes the architecture implemented in the current codebase.

## System model

`harness` is a source-of-truth generator:

- Canonical input lives under `.harness/src/*`.
- Runtime state lives in:
  - `.harness/manifest.json`
  - `.harness/manifest.lock.json`
  - `.harness/managed-index.json`
  - `.harness/imports/skills/*.json` (third-party import provenance sidecars; not canonical entities)
- Provider-native artifacts are generated into repository paths (for example `AGENTS.md`, `.claude/*`, `.github/*`, `.vscode/*`, `.codex/config.toml`).

Only enabled providers receive generated artifacts. Supported providers are `codex`, `claude`, and `copilot`.

## Workspace contract

Canonical entity types:

- `prompt_section` (0 or more; sections compose into a single system prompt per provider, in manifest entity order)
- `skill`
- `mcp_config`
- `subagent`
- `hook`
- `settings` (per-provider; id is the provider name)
- `command`

Every entity accepts an optional `target` (a relative directory such as `packages/web`) that
relocates its generated artifacts into a sub-project for monorepos. `target` never affects the
canonical source location, and it is applied per provider capability. See
[monorepo support](./monorepo.md).

Bootstrap primitive:

- `preset` is intentionally not a canonical manifest entity. It is a bootstrap macro that materializes normal harness state such as registries, enabled providers, and source entities.

Default source locations:

- Prompt sections: `.harness/src/prompt-sections/<id>/SECTION.md`
- Skills: `.harness/src/skills/<id>/SKILL.md`
- MCP: `.harness/src/mcp/<id>.json`
- Subagents: `.harness/src/subagents/<id>.md`
- Hooks: `.harness/src/hooks/<id>.json`
- Settings: `.harness/src/settings/<provider>.json` (codex uses `.toml`)
- Commands: `.harness/src/commands/<id>.md`

Provider override sidecars are YAML files with schema `version: 1` and optional `enabled`, `targetPath`, `options`.

## Environment variables

Entity source files and override sidecars support `{{PLACEHOLDER}}` syntax for injecting values at apply time.

Env var sources (resolution order, highest priority first):

1. `.harness/.env` — per-workspace secrets (gitignored)
2. `.env.harness` — project-root shared parameters (optionally committed)
3. `process.env` — CI/CD fallback

Substitution happens on raw file text before parsing (JSON, YAML, frontmatter). SHA256 fingerprints in the lock file are computed on the raw (pre-substitution) text, keeping the lock stable when only env values change.

Unresolved placeholders produce `ENV_VAR_UNRESOLVED` warnings but do not block apply.

See also: [Environment Variables Guide](./environment-variables.md)

## Hook primitive

`hook` is a canonical lifecycle-hook primitive rendered into provider-native hook formats.

See also: [Hook Authoring Guide](./hook-authoring.md)

Canonical hook source shape:

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "matcher": "Bash",
        "command": "echo pre-tool",
        "timeoutSec": 15
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

Notes:

- `mode` defaults to `"strict"`; `"best_effort"` suppresses unsupported-provider failures.
- Supported canonical handler types are `command` and `notify`.
- `events` is required; unknown canonical event names are validation errors.
- `notify` handlers currently model Codex notification behavior (`agent-turn-complete`).

## Provider mapping rules

### Prompt sections

- Every enabled `prompt_section` composes into one system-prompt artifact per provider. Section
  bodies (frontmatter stripped) are joined with a blank line, in manifest entity order (which reflects preset operation order / add sequence).
- `codex -> AGENTS.md`
- `claude -> CLAUDE.md`
- `copilot -> .github/copilot-instructions.md`
- `cursor` emits no prompt artifact. Zero sections means no prompt artifact for any provider.

### Skill

- Replicates skill directory payload to each provider’s skill root.

### MCP

- Merges all enabled MCP entities into one provider-native artifact.
- Duplicate MCP server IDs with differing definitions are hard errors.

### Subagent

- Claude: one markdown file per subagent at `.claude/agents/<id>.md`
- Copilot: one markdown file per subagent at `.github/agents/<id>.agent.md`
- Codex: merged into `.codex/config.toml` under `[agents.<id>]`

### Hook

- Claude: rendered into `.claude/settings.json` as `hooks` configuration.
- Copilot: rendered into `.github/hooks/harness.generated.json` (`version: 1` + `hooks` map).
- Codex: projected into `.codex/config.toml` as inline `[hooks]` lifecycle tables for supported events, plus top-level
  `notify = [...]` for canonical `turn_complete`.

In strict mode, unsupported provider/event/type projections fail with `HOOK_EVENT_UNSUPPORTED`.

## Registries

Manifest registries:

- Built-in immutable local registry: `local`
- Optional git registries with `{ url, ref, rootPath?, tokenEnvVar? }`
- Every entity carries a `registry` field

### Registry repository layout (strict root)

A git registry's root holds **only** three things: skills, prompt-sections, and preset packages.

- `skills/<category>/<id>/SKILL.md` — root skills, grouped into dynamic **category** folders. Category is the folder segment directly under `skills/` (folder-derived, never in frontmatter). Ids are globally unique across categories, so `add`/`pull` reference a skill by its bare `id`. Empty category folders (a lone `.gitkeep`) are allowed.
- `prompt-sections/<category>/<id>/SECTION.md` — root prompt-sections, same category layout. The prompt-section category tree is independent of the skill tree, and an id may be shared between a skill and a prompt-section (uniqueness is per entity kind).
- `presets/<id>/` — preset packages (see below).
- `harness-registry.json` — required registry manifest.

`SKILL.md` / `SECTION.md` frontmatter may carry an optional `tags: string[]`. `registry validate` rejects a root `mcp/`, `subagents/`, `hooks/`, `settings/`, `commands/`, or legacy `prompts/` folder (`REGISTRY_ROOT_ENTITY_FORBIDDEN`) — those entity kinds exist only **inside preset packages**.

Only **skills** and **prompt-sections** are registry-sourceable: `add <skill|prompt-section> --registry <name>` and `registry pull` operate on them (and fetching any other type throws `REGISTRY_ENTITY_UNSUPPORTED_TYPE`). Every other entity type reaches a workspace by applying a preset that embeds it (materialized as a `local` entity).

### Preset extension (`extends`)

A registry preset may declare a top-level `extends: <parent-id>`. The child inherits only the parent's `add_skill` and `add_prompt_section` operations (transitively up the chain), prepended parent-first before the child's own; all other operation kinds are never inherited. Inherited ops are deduped by `(kind, id)` with the nearest/child definition winning, and the parent's embedded skill/prompt-section files are merged forward so inherited embedded ops resolve. Cycles (`PRESET_EXTENDS_CYCLE`) and unknown parents (`PRESET_EXTENDS_NOT_FOUND`) are errors. `extends` is registry-only; a builtin or local preset that declares it fails with `PRESET_EXTENDS_UNSUPPORTED_SOURCE`.

CLI registry commands:

- `harness registry list|validate|add|remove`
- `harness registry default show|set`
- `harness registry pull [entity-type] [id] [--registry <name>] [--force]`

CLI third-party skill commands:

- `harness skill find <query>`
- `harness skill import <source> --skill <upstream-skill> [--as <harness-id>] [--replace] [--allow-unsafe] [--allow-unaudited]`

`skill import` is snapshot-only in v1 (no auto-sync) and persists provenance metadata in `.harness/imports/skills/<id>.json`.

## Planning/apply pipeline

High-level flow (`loader.ts` + `planner.ts` + `engine.ts`):

1. Validate workspace versions (doctor preflight for normal runtime commands).
2. Load and semantically validate manifest.
3. Load environment variables from `.harness/.env` and `.env.harness`.
4. Enforce source ownership (`SOURCE_UNREGISTERED` for unmanaged source candidates).
5. Load canonical entities + provider override sidecars (with env var substitution).
6. Render provider artifacts through adapters:
   - per-entity renders (`prompt`, `skill`, `subagent`, `hook`)
   - optional provider-state render (`codex` composite state for MCP/subagent/lifecycle hooks/notify)
7. Detect collisions, unmanaged collisions, drift, creates, updates, and stale deletes.
8. Build deterministic `operations`, `nextLock`, and `nextManagedIndex`.
9. `plan` returns diagnostics/operations only.
10. `apply` writes create/update/delete operations and persists lock/index.

## Ownership and collisions

- Source files are expected to be CLI-managed and registered in manifest.
- Existing unmanaged output files at generated target paths block apply (`OUTPUT_COLLISION_UNMANAGED`).
- Multiple providers (or artifacts) targeting the same path with conflicting content fail with `OUTPUT_PATH_COLLISION`.
- Conflicting hook target-path overrides for a provider fail with `HOOK_TARGET_CONFLICT` (Claude/Copilot). For Codex, hook `targetPath` overrides resolved via `.codex/config.toml` report `CODEX_CONFIG_TARGET_CONFLICT` and may also conflict with MCP/subagent overrides.

## CLI surface

Core commands:

- `init`
- `provider enable|disable`
- `add prompt-section|skill|mcp|subagent|hook`
- `remove <entity-type> <id>`
- `registry ...` (management + pull)
- `skill find|import` (third-party discovery/import through pinned `skills@1.4.6`)
- `preset list|describe|apply`
- `validate`
- `doctor`
- `migrate`
- `plan`
- `apply`
- `watch`

## Preset package layout

Preset packages are self-contained directories used by bundled, local, and registry presets:

- `preset.json` — preset metadata and ordered operations
- `prompt-sections/<id>/SECTION.md` — optional embedded prompt-section sources (any number)
- `skills/<id>/**` — optional embedded skill content
- `mcp/<id>.json` — optional embedded MCP config content
- `subagents/<id>.md` — optional embedded subagent content
- `hooks/<id>.json` — optional embedded hook content
- `settings/<provider>.json|toml` — optional embedded settings content
- `commands/<id>.md` — optional embedded command content

Preset application is intentionally outside the planner/provider-render pipeline. The preset layer runs first, writes normal harness-managed source files and manifest state, and then the existing `validate` / `plan` / `apply` flow operates unchanged.

## Watch behavior

`watch` monitors:

- `.harness/manifest.json`
- `.harness/src/**/*.md`
- `.harness/src/**/*.json`
- `.harness/src/**/*.overrides.*.yaml`
- `.harness/src/**/OVERRIDES.*.yaml`
- `.harness/.env`
- `.env.harness` (project root)

It debounces changes, runs apply in single-flight mode, and continues after errors.

## Packages

- `packages/manifest-schema`
  - Zod schemas and type exports for manifest/lock/index/overrides/registries.
- `packages/toolkit`
  - CLI entrypoint and programmatic API.
  - Engine, loader, planner, repository I/O, provider adapters, hook parser/projection, version doctor/migration.

## Versioning

Normal runtime commands require current schema versions. Migration is explicit (`harness migrate`) and creates backups before rewriting state files.

See [architecture/versioning.md](./architecture/versioning.md).
