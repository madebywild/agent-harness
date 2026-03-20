# Architecture

This document describes the architecture implemented in the current codebase.

## System model

`harness` is a source-of-truth generator:

- Canonical input lives under `.harness/src/*`.
- Runtime state lives in:
  - `.harness/manifest.json`
  - `.harness/manifest.lock.json`
  - `.harness/managed-index.json`
- Provider-native artifacts are generated into repository paths (for example `AGENTS.md`, `.claude/*`, `.github/*`, `.vscode/*`, `.codex/config.toml`).

Only enabled providers receive generated artifacts. Supported providers are `codex`, `claude`, and `copilot`.

## Workspace contract

Canonical entity types:

- `prompt` (0 or 1 entity; id must be `system`)
- `skill`
- `mcp_config`
- `subagent`
- `hook`

Default source locations:

- Prompt: `.harness/src/prompts/system.md`
- Skills: `.harness/src/skills/<id>/SKILL.md`
- MCP: `.harness/src/mcp/<id>.json`
- Subagents: `.harness/src/subagents/<id>.md`
- Hooks: `.harness/src/hooks/<id>.json`

Provider override sidecars are YAML files with schema `version: 1` and optional `enabled`, `targetPath`, `options`.

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

### Prompt

- `codex -> AGENTS.md`
- `claude -> CLAUDE.md`
- `copilot -> .github/copilot-instructions.md`

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
- Codex: projected into `.codex/config.toml` notify command only (canonical `turn_complete`).

In strict mode, unsupported provider/event/type projections fail with `HOOK_EVENT_UNSUPPORTED`.

## Registries

Manifest registries:

- Built-in immutable local registry: `local`
- Optional git registries with `{ url, ref, rootPath?, tokenEnvVar? }`
- Every entity carries a `registry` field

`add` can materialize from git registries (not only local scaffolding), including hook entities (`hooks/<id>.json` in registry layout).

CLI registry commands:

- `harness registry list|validate|add|remove`
- `harness registry default show|set`
- `harness registry pull [entity-type] [id] [--registry <name>] [--force]`

## Planning/apply pipeline

High-level flow (`loader.ts` + `planner.ts` + `engine.ts`):

1. Validate workspace versions (doctor preflight for normal runtime commands).
2. Load and semantically validate manifest.
3. Enforce source ownership (`SOURCE_UNREGISTERED` for unmanaged source candidates).
4. Load canonical entities + provider override sidecars.
5. Render provider artifacts through adapters:
   - per-entity renders (`prompt`, `skill`, `subagent`, `hook`)
   - optional provider-state render (`codex` composite state for MCP/subagent/hook notify)
6. Detect collisions, unmanaged collisions, drift, creates, updates, and stale deletes.
7. Build deterministic `operations`, `nextLock`, and `nextManagedIndex`.
8. `plan` returns diagnostics/operations only.
9. `apply` writes create/update/delete operations and persists lock/index.

## Ownership and collisions

- Source files are expected to be CLI-managed and registered in manifest.
- Existing unmanaged output files at generated target paths block apply (`OUTPUT_COLLISION_UNMANAGED`).
- Multiple providers (or artifacts) targeting the same path with conflicting content fail with `OUTPUT_PATH_COLLISION`.
- Conflicting hook target-path overrides for a provider fail with `HOOK_TARGET_CONFLICT`.

## CLI surface

Core commands:

- `init`
- `provider enable|disable`
- `add prompt|skill|mcp|subagent|hook`
- `remove <entity-type> <id>`
- `registry ...` (management + pull)
- `validate`
- `doctor`
- `migrate`
- `plan`
- `apply`
- `watch`

## Watch behavior

`watch` monitors:

- `.harness/manifest.json`
- `.harness/src/**/*.md`
- `.harness/src/**/*.json`
- `.harness/src/**/*.overrides.*.yaml`
- `.harness/src/**/OVERRIDES.*.yaml`

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
