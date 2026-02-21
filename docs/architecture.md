# Agent Harness v1 Plan: Unified `.harness` Source With Provider Generators

## Summary
Build a TypeScript + `pnpm` monorepo CLI (`harness`) where `.harness` is the only editable source for agent config entities, and provider outputs are generated directly into provider-native paths.

## Schema Versioning Architecture

Versioning is now explicit and enforced across `.harness` state files:

1. Runtime compatibility:
   - Normal commands run only on current schema versions.
   - If any file is outdated/newer/invalid, mutating/runtime commands stop before writes.
2. Version diagnostics:
   - `harness doctor` scans `.harness/manifest.json`, `.harness/manifest.lock.json`, `.harness/managed-index.json`, and discovered override sidecars.
   - It reports per-file status (`current|outdated|unsupported|invalid|missing`) and actionable diagnostics.
3. Migration flow:
   - `harness migrate` performs explicit upgrades only (`--to latest`).
   - Pre-write backup snapshot: `.harness/.backup/<timestamp>/...`.
   - Per-file atomic writes (temp file + rename).
   - Deterministic write order: overrides, lock, managed-index, manifest (manifest last).
4. Forward compatibility safety:
   - Older CLI never mutates newer workspace schemas.
   - Newer-than-supported files emit `*_VERSION_NEWER_THAN_CLI` and `MIGRATION_DOWNGRADE_UNSUPPORTED`.
5. Derived-state rebuild after migration:
   - Lock and managed-index are rebuilt from desired rendered outputs.
   - Managed-index adopts desired output paths during migration to prevent first-apply unmanaged collision deadlocks.
6. Idempotency and resumability:
   - No global multi-file transaction is used.
   - Migration reruns converge deterministically; mixed-version states surface as `MIGRATION_INCOMPLETE`.

This plan is anchored to the current repo state (`/Users/tom/Github/harness` at empty `HEAD`) and uses strict ownership rules:
1. Entity files are created only via CLI commands.
2. Source content is user-editable.
3. Generated provider files are immutable and always regenerated.
4. Unmanaged collisions fail with actionable errors.

## Final Scope (Locked)
1. Providers in v1: `codex`, `claude`, `copilot`.
2. Entities in v1: `prompt`, `skill`, `mcp_config`.
3. `lifecycle_hooks` and `subagents`: not implemented in v1.
4. Prompt cardinality: zero or one system prompt entity (optional).
5. Provider enablement: global opt-in at CLI level; enabled providers receive all entity types.
6. Output location: provider-native paths directly in repo.
7. Ownership mode: strict, registry-enforced.
8. `add` semantics: scaffold new source entities only (no import in v1).
9. Sidecars: per-entity sidecar override files in YAML.
10. Override scope: metadata/path/options only, never full content override.

## Repository and Package Layout
Create from scratch in `/Users/tom/Github/harness`:

```text
/Users/tom/Github/agent-harness/
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  tsconfig.json
  /packages/manifest-schema
  /packages/toolkit
```

Package roles:
1. `/Users/tom/Github/agent-harness/packages/manifest-schema`
   - Zod schemas + exported TS types for manifest, lock, managed-index, sidecars.
   - JSON Schema export for external tooling.
2. `/Users/tom/Github/agent-harness/packages/toolkit`
   - CLI binary `harness`.
   - Core planner/applier/watcher.
   - Provider adapter implementations.

## `.harness` Filesystem Contract
CLI owns and maintains:

```text
/Users/tom/Github/agent-harness/.harness/
  manifest.json
  manifest.lock.json
  managed-index.json
  /src
    /prompts
      system.md
      system.overrides.codex.yaml
      system.overrides.claude.yaml
      system.overrides.copilot.yaml
    /skills
      /<skill-id>
        SKILL.md
        OVERRIDES.codex.yaml
        OVERRIDES.claude.yaml
        OVERRIDES.copilot.yaml
        ...(extra skill files allowed)
    /mcp
      <config-id>.json
      <config-id>.overrides.codex.yaml
      <config-id>.overrides.claude.yaml
      <config-id>.overrides.copilot.yaml
```

Generated targets (examples when all providers enabled):
1. Codex:
   - `/Users/tom/Github/agent-harness/AGENTS.md`
   - `/Users/tom/Github/agent-harness/.codex/skills/<skill-id>/...`
   - `/Users/tom/Github/agent-harness/.codex/config.toml`
2. Claude:
   - `/Users/tom/Github/agent-harness/CLAUDE.md`
   - `/Users/tom/Github/agent-harness/.claude/skills/<skill-id>/...`
   - `/Users/tom/Github/agent-harness/.mcp.json`
3. Copilot:
   - `/Users/tom/Github/agent-harness/.github/copilot-instructions.md`
   - `/Users/tom/Github/agent-harness/.github/skills/<skill-id>/...`
   - `/Users/tom/Github/agent-harness/.vscode/mcp.json`

## Public APIs / Interfaces / Types
Expose from toolkit package:

```ts
export type ProviderId = "codex" | "claude" | "copilot";
export type EntityType = "prompt" | "skill" | "mcp_config";

export interface AgentsManifest {
  version: 1;
  providers: { enabled: ProviderId[] };
  entities: EntityRef[];
}

export interface EntityRefBase {
  id: string;
  type: EntityType;
  sourcePath: string;
  overrides?: Partial<Record<ProviderId, string>>;
  enabled?: boolean;
}

export interface PromptEntityRef extends EntityRefBase {
  type: "prompt";
}

export interface SkillEntityRef extends EntityRefBase {
  type: "skill";
}

export interface McpEntityRef extends EntityRefBase {
  type: "mcp_config";
}

export type EntityRef = PromptEntityRef | SkillEntityRef | McpEntityRef;

export interface ProviderOverride {
  version: 1;
  enabled?: boolean;
  targetPath?: string;
  options?: Record<string, unknown>;
}

export interface CanonicalPrompt { id: string; body: string; frontmatter: Record<string, unknown>; }
export interface CanonicalSkill { id: string; files: Array<{ path: string; sha256: string }>; }
export interface CanonicalMcpConfig { id: string; json: Record<string, unknown>; }

export interface RenderedArtifact {
  path: string;
  content: string;
  ownerEntityId: string;
  provider: ProviderId;
  format: "markdown" | "json" | "toml";
}

export interface ProviderAdapter {
  id: ProviderId;
  renderPrompt?(input: CanonicalPrompt, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderSkill?(input: CanonicalSkill, override?: ProviderOverride): Promise<RenderedArtifact[]>;
  renderMcp?(input: CanonicalMcpConfig[], overrideByEntity?: Map<string, ProviderOverride>): Promise<RenderedArtifact[]>;
}

export interface ManifestLock {
  version: 1;
  generatedAt: string;
  manifestFingerprint: string;
  entities: Array<{ id: string; type: EntityType; sourceSha256: string; overrideSha256ByProvider: Partial<Record<ProviderId, string>> }>;
  outputs: Array<{ path: string; provider: ProviderId; contentSha256: string; ownerEntityIds: string[] }>;
}

export interface ManagedIndex {
  version: 1;
  managedSourcePaths: string[];
  managedOutputPaths: string[];
}
```

## Core Data Flow (No Duplication Design)
1. Load and Zod-validate `manifest.json`.
2. Enforce source ownership:
   - Scan `.harness/src` for known entity candidates.
   - Any candidate not present in manifest is a hard error.
3. Load canonical entity content.
4. Load provider sidecars and merge metadata-only overrides.
5. For each enabled provider, run adapter recipe over canonical models.
6. Produce desired artifact set with deterministic ordering.
7. Compare desired outputs to lock/index and filesystem.
8. `plan`: emit operations and diagnostics only.
9. `apply`: write managed outputs, update lock/index.
10. `watch`: monitor source + manifest + sidecars, then run plan/apply loop.

This keeps one canonical content source while allowing provider-specific behavior through typed sidecar metadata and adapter logic.

## CLI Command Contract
1. `harness init`
   - Creates `.harness` structure + empty manifest + lock + index.
2. `harness provider enable <codex|claude|copilot>`
3. `harness provider disable <codex|claude|copilot>`
4. `harness add prompt`
   - Creates only `.harness/src/prompts/system.md` and manifest entry.
   - Fails if prompt already exists.
5. `harness add skill <skill-id>`
   - Creates `.harness/src/skills/<skill-id>/SKILL.md` and manifest entry.
6. `harness add mcp <config-id>`
   - Creates `.harness/src/mcp/<config-id>.json` and manifest entry.
7. `harness remove <prompt|skill|mcp> <id>`
   - Removes entity from manifest; optionally deletes source with `--delete-source`.
   - For prompts in v1, id must be `system`.
8. `harness validate`
   - Schema, ownership, collisions, and drift checks.
9. `harness plan [--json]`
   - Lists create/update/delete operations and diagnostics.
10. `harness apply [--json]`
   - Executes plan and rewrites managed files.
11. `harness watch [--debounce 250]`
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
4. Override sidecars:
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
5. No lifecycle hooks or subagents in v1.
6. No provider import/adoption flow in v1.
7. Generated files are fully CLI-managed artifacts.

## External Convention References Used
1. [OpenAI Codex config reference](https://developers.openai.com/codex/config-reference)
2. [OpenAI AGENTS.md guide](https://developers.openai.com/codex/agents)
3. [Anthropic Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings)
4. [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
5. [VS Code Copilot agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
6. [VS Code Copilot MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
