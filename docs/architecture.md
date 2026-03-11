# Architecture

This document describes the architecture implemented in the current codebase.

## System model

`harness` is a source-of-truth generator:

- Canonical input lives under `.harness/src/*`.
- Runtime state lives in `.harness/manifest.json`, `.harness/manifest.lock.json`, and `.harness/managed-index.json`.
- Provider-native artifacts are generated into repository paths (for example `AGENTS.md`, `.claude/*`, `.github/*`, `.vscode/mcp.json`).

Only enabled providers receive generated artifacts. Supported providers are currently `codex`, `claude`, and `copilot`.

## Workspace contract

Canonical entity types:

- `prompt` (0 or 1 entity; id must be `system`)
- `skill`
- `mcp_config`
- `subagent`

Default source locations:

- Prompt: `.harness/src/prompts/system.md`
- Skills: `.harness/src/skills/<id>/SKILL.md`
- MCP: `.harness/src/mcp/<id>.json`
- Subagents: `.harness/src/subagents/<id>.md`

Provider override sidecars are YAML files with schema `version: 1` and optional `enabled`, `targetPath`, `options`.

## Registries

Manifests include a registry section:

- Built-in immutable local registry: `local`
- Optional git registries with `{ url, ref, rootPath?, tokenEnvVar? }`
- Every entity carries a `registry` field

CLI registry commands:

- `harness registry list|validate|add|remove`
- `harness registry default show|set`
- `harness registry pull [entity-type] [id] [--registry <name>] [--force]`

`add` can materialize from git registries (not only local scaffolding).

## Planning and apply pipeline

High-level flow (`loader.ts` + `planner.ts` + `engine.ts`):

1. Validate workspace versions (doctor preflight for plan/apply/watch; explicit `migrate` for upgrades).
2. Load and semantically validate manifest.
3. Enforce source ownership: unmanaged candidate source files emit hard diagnostics.
4. Load canonical entities + sidecar overrides.
5. Render provider artifacts through adapters.
6. Detect output collisions, unmanaged collisions, drift, creates, updates, and stale deletes.
7. Build deterministic `operations`, `nextLock`, and `nextManagedIndex`.
8. `plan` returns diagnostics/operations only.
9. `apply` writes create/update/delete operations and persists lock/index.

`watch` runs `apply` in a loop over `.harness/manifest.json` and source/override file changes.

## Ownership and collision rules

- Source files are expected to be CLI-managed and registered in manifest.
- Existing unmanaged output files at generated target paths block apply (`OUTPUT_COLLISION_UNMANAGED`).
- Multiple providers (or artifacts) targeting the same path with conflicting content fail with `OUTPUT_PATH_COLLISION`.

## Packages

- `packages/manifest-schema`:
  - Zod schemas and type exports for manifest, lock, managed index, overrides, registries.
  - Version detection/assertion and JSON schema export.
- `packages/toolkit`:
  - CLI entrypoint and programmatic API.
  - Engine, loader, planner, repository I/O, provider adapters, version doctor/migration.

## CLI surface

Core commands:

- `init`
- `provider enable|disable`
- `add prompt|skill|mcp|subagent`
- `remove <entity-type> <id>`
- `registry ...` (management + pull)
- `validate`
- `doctor`
- `migrate`
- `plan`
- `apply`
- `watch`

## Versioning

Normal runtime commands require current schema versions. Migration is explicit (`harness migrate`) and creates backups before rewriting state files.

See [architecture/versioning.md](./architecture/versioning.md) for detailed migration and compatibility behavior.
8. `harness remove <prompt|skill|mcp|subagent> <id>`
   - Removes entity from manifest; deletes source by default (opt out with `--no-delete-source`).
   - For prompts in v1, id must be `system`.
9. `harness validate`
   - Schema, ownership, collisions, and drift checks.
10. `harness plan [--json]`
   - Lists create/update/delete operations and diagnostics.
11. `harness apply [--json]`
   - Executes plan and rewrites managed files.
12. `harness watch [--debounce 250]`
   - Foreground watcher; initial apply on startup.

## Strict Ownership and Collision Rules
1. Source files:
   - Unknown candidate files under `.harness/src` are errors.
2. Target files:
   - If target path exists and is not listed in `managed-index.json`, fail with collision diagnostic and migration hint.
3. Managed outputs:
   - Manual edits are treated as drift; next `apply` rewrites to canonical output.
4. No import/adopt in v1:
   - Existing unmanaged provider files must be moved/removed manually before first apply.

## Provider Mapping Rules
1. Prompt:
   - `codex -> AGENTS.md`
   - `claude -> CLAUDE.md`
   - `copilot -> .github/copilot-instructions.md`
2. Skill:
   - Replicate skill directory to each provider’s skill location.
3. MCP:
   - Merge all MCP entities into provider-specific single config artifact.
   - Duplicate server IDs with differing definitions are hard errors.
4. Subagent:
   - Claude: one markdown file per subagent at `.claude/agents/<id>.md`.
   - Copilot: one markdown file per subagent at `.github/agents/<id>.agent.md`.
   - Codex: merged into `.codex/config.toml` under `[agents.<id>]`, sharing the file with `mcp_servers`.
5. Override sidecars:
   - Can change target path and typed options.
   - Cannot override canonical body/content.

## Watch Mode Behavior
1. Watches:
   - `.harness/manifest.json`
   - `.harness/src/**/*.md`
   - `.harness/src/**/*.json`
   - `.harness/src/**/*.overrides.*.yaml`
   - `.harness/src/**/OVERRIDES.*.yaml`
2. Ignores generated output paths to avoid loops.
3. Debounced apply queue with single-flight execution.
4. On error, watch continues and reports latest diagnostic set.

## Implementation Phases
1. Bootstrap monorepo and package scripts.
2. Implement schemas/types in `manifest-schema`.
3. Implement parser/validator, ownership scanner, lock/index logic.
4. Implement provider adapters for prompt/skill/mcp.
5. Implement planner/applier.
6. Implement CLI commands.
7. Implement watch mode and debounce queue.
8. Add tests and CI gates.

## Test Cases and Acceptance Scenarios
1. `init` creates valid `.harness` structure and schemas validate.
2. `add prompt` succeeds once and fails on second attempt.
3. `add skill` and `add mcp` scaffold correctly and register in manifest.
4. Unknown manually-created source candidate under `.harness/src` fails `validate/plan/apply`.
5. Provider opt-in matrix works: only enabled providers generate outputs.
6. Prompt generation writes correct file paths for each provider.
7. Skill generation copies full directory payloads deterministically.
8. MCP merge produces valid TOML/JSON outputs per provider.
9. MCP conflict on same server ID with different values fails with clear diagnostic.
10. Existing unmanaged target file causes collision failure.
11. Manual edit to managed output is detected in plan and corrected by apply.
12. `manifest.lock.json` is byte-stable on no-op apply.
13. `watch` reacts to source changes and ignores generated-output writes.
14. Sidecar `targetPath` overrides reroute outputs deterministically.
15. Invalid sidecar schema fails with path+field diagnostics.

## Assumptions and Defaults
1. Start from current empty `HEAD` in `/Users/tom/Github/harness`.
2. Node runtime baseline: `>=22`.
3. Monorepo uses `pnpm` workspaces + Turborepo.
4. Single prompt entity in v1.
5. No lifecycle hooks in v1.
6. No provider import/adoption flow in v1.
7. Generated files are fully CLI-managed artifacts.

## External Convention References Used
1. [OpenAI Codex config reference](https://developers.openai.com/codex/config-reference)
2. [OpenAI AGENTS.md guide](https://developers.openai.com/codex/agents)
3. [Anthropic Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings)
4. [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
5. [VS Code Copilot agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
6. [VS Code Copilot MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
