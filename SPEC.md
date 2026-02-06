# Agent Harness v1 Spec: Manifest-First Monorepo (Turborepo + pnpm)

## Summary
1. Build a monorepo at `/Users/tom/Github/agent-harness` with two publishable packages: `@agent-harness/manifest-schema` and `@agent-harness/toolkit`.
2. Define a declarative source config (`agent-harness.config.json`) and a generated lock-manifest (`agent-harness.lock.json`) with deterministic semantics similar to lockfiles.
3. Implement a processor pipeline that maps `resource -> vendor processor -> artifact fragments -> merged artifacts`, with explicit collision modeling for shared artifact paths.
4. Ship v1 adapters for Codex, Claude Code, and GitHub Copilot, with unsupported mappings (for genuinely unsupported combinations) handled as warnings and recorded in lock state.
5. Expose both CLI and library APIs in v1, and define a public plugin API for external processors.

## Monorepo Layout
| Path | Purpose | Publish |
|---|---|---|
| `/Users/tom/Github/agent-harness/package.json` | Root scripts, workspace config, package manager pin | No |
| `/Users/tom/Github/agent-harness/pnpm-workspace.yaml` | Workspace package discovery | No |
| `/Users/tom/Github/agent-harness/turbo.json` | Task graph (`build`, `test`, `lint`, `typecheck`) | No |
| `/Users/tom/Github/agent-harness/packages/manifest-schema` | JSON Schemas + RFC-style spec docs + examples | Yes (`@agent-harness/manifest-schema`) |
| `/Users/tom/Github/agent-harness/packages/toolkit` | CLI + core engine + built-in processors | Yes (`@agent-harness/toolkit`) |
| `/Users/tom/Github/agent-harness/docs` | Architecture and provider matrix docs | No |

## Public Interfaces and Types (v1)
1. Source config file: `/Users/tom/Github/agent-harness/agent-harness.config.json`.
2. Lock-manifest file: `/Users/tom/Github/agent-harness/agent-harness.lock.json`.
3. CLI binary name: `agent-harness`.
4. Library API exports from `@agent-harness/toolkit`:
```ts
export type ResourceType =
  | "skill"
  | "mcp_server"
  | "system_prompt"
  | "lifecycle_hook"
  | "environment_config"
  | "subagent";

export type VendorId = "codex" | "claude" | "copilot" | string;

export interface HarnessConfig { /* schema-backed */ }
export interface HarnessLock { /* schema-backed */ }

export interface PlanResult {
  operations: Operation[];
  diagnostics: Diagnostic[];
  nextLock: HarnessLock;
}

export interface ApplyResult extends PlanResult {
  writtenArtifacts: string[];
  prunedArtifacts: string[];
}

export function loadConfig(path?: string): Promise<HarnessConfig>;
export function validateConfig(config: HarnessConfig): ValidationResult;
export function plan(config: HarnessConfig, opts?: PlanOptions): Promise<PlanResult>;
export function apply(config: HarnessConfig, opts?: ApplyOptions): Promise<ApplyResult>;
export function validateLock(lock: HarnessLock): ValidationResult;
```
5. Public plugin API (stable in v1):
```ts
export interface ProcessorPlugin {
  apiVersion: "1.0";
  pluginId: string;
  vendor: VendorId;
  supports: ResourceType[];
  transform(input: ProcessorInput): Promise<ProcessorOutput>;
}

export interface ProcessorOutput {
  bindings: BindingRecord[];
  fragments: ArtifactFragment[];
  diagnostics: Diagnostic[];
}
```

## Manifest Model (Lockfile) Specification
1. `agent-harness.lock.json` is generated-only. Toolkit is authoritative writer.
2. Top-level required fields:
   - `$schema` (URL to schema in `@agent-harness/manifest-schema`)
   - `lockfileVersion` (integer, starts at `1`)
   - `generatedAt` (ISO timestamp)
   - `generatedBy` (`toolkitVersion`, `nodeVersion`, `platform`)
   - `configFingerprint` (sha256 of normalized source config + plugin set)
   - `vendors` (resolved vendor set and adapter versions)
   - `resources` (canonicalized resource instances with content hashes)
   - `bindings` (resource/vendor/processor execution records)
   - `artifacts` (final outputs + contribution matrix)
   - `diagnostics` (warnings/errors snapshot)
3. Key relation objects:
   - `resources[]`: canonical desired components.
   - `bindings[]`: one execution edge for each `resource x vendor x processor`.
   - `artifacts[]`: one output file target with merge metadata and contributors.
   - `artifacts[].contributors[]`: references `bindingId`, fragment key, and byte/section ownership.
4. Determinism rules:
   - Stable key ordering in JSON serialization.
   - Stable list sorting by deterministic IDs.
   - Path normalization to POSIX relative paths.
   - UTF-8 + `\n` line endings for managed outputs.
5. Lock drift policy:
   - Manual lock edits are detected (fingerprint mismatch).
   - `apply` rewrites lock from computed state.
   - Diagnostic severity is warning by default, error under `--strict`.

## Source Config Specification
1. File: `/Users/tom/Github/agent-harness/agent-harness.config.json`.
2. Required sections:
   - `version` (starts at `1`)
   - `vendors` (enabled vendors + vendor options)
   - `resources` (declarative resources and targets)
3. Optional sections:
   - `plugins` (external processor plugin package names)
   - `policy` (`unsupported`, `pruneDefault`, `conflictMode`)
4. Resource object must include:
   - `id` (stable user-defined ID)
   - `type` (`skill`, `mcp_server`, `system_prompt`, `lifecycle_hook`, `environment_config`, `subagent`)
   - `source` (`path` or `inline`)
   - `targets` (vendor IDs)
   - `options` (vendor-specific overrides)

## Processing Pipeline (Toolkit Core)
1. Parse and schema-validate config.
2. Normalize resources and compute hashes.
3. Resolve processor registry (built-in + plugins).
4. Execute processors per `resource x target vendor`.
5. Emit binding records and artifact fragments.
6. Merge fragments by artifact key using deterministic strategy.
7. Produce plan, write artifacts on `apply`, update lockfile.
8. On `apply --prune`, remove stale managed outputs and stale managed sections only.

## Artifact Collision and Merge Matrix
1. Every artifact has canonical key `artifactId = normalizedPath`.
2. Shared-path collisions are legal and first-class.
3. Merge strategies allowed in v1:
   - `single_owner_replace`
   - `ordered_concat`
   - `json_object_merge`
   - `managed_sections`
4. `managed_sections` is required for shared Markdown/text artifacts (example: `AGENTS.md`) and uses explicit markers to allow safe removal of one contributor without clobbering unrelated content.
5. Conflict rules:
   - Same artifact with incompatible merge strategies is an error.
   - Same section ownership collision is an error unless identical content hash.
   - `--strict` escalates warnings to errors.

## Vendor Capability Matrix (Built-in v1)
| Resource Type | Codex | Claude Code | GitHub Copilot |
|---|---|---|---|
| `system_prompt` | Supported (`AGENTS.md`) | Supported (`CLAUDE.md`) | Supported (`.github/copilot-instructions.md`, optional AGENTS mode) |
| `skill` | Supported (`.codex/skills/.../SKILL.md`) | Supported (mapped to slash-command style docs under `.claude/commands/...`) | Supported (`.github/skills/<skill-name>/SKILL.md`) |
| `mcp_server` | Supported (`.codex/config.toml`) | Supported (`.mcp.json` / Claude settings model) | Supported (`.vscode/mcp.json`) |
| `lifecycle_hook` | Unsupported in built-in v1 (warn+skip) | Supported (`.claude/settings.json` hooks) | Supported (`.github/hooks/*.json`) |
| `environment_config` | Unsupported in built-in v1 (warn+skip) | Supported (`.claude/settings.json` env) | Unsupported in built-in v1 (warn+skip) |
| `subagent` | Unsupported in built-in v1 (warn+skip) | Supported (`.claude/agents/...`) | Supported (`.github/agents/*.agent.md`) |

## CLI Specification
1. `agent-harness validate`
   - Validates config and existing lockfile.
   - Exit `0` on valid, `1` on schema or structural errors.
2. `agent-harness plan`
   - Computes operations and diagnostics, no writes.
   - Supports `--json` for machine-readable plan output.
3. `agent-harness apply`
   - Writes generated artifacts and lockfile.
   - Supports `--prune`, `--strict`, `--dry-run`.
4. `agent-harness diff`
   - Shows desired-vs-current delta based on lock and filesystem.
5. Common flags:
   - `--config <path>`
   - `--lockfile <path>`
   - `--cwd <path>`

## Turborepo + pnpm Setup
1. Use `pnpm` workspaces and Turbo task graph.
2. Root scripts:
   - `build`, `test`, `lint`, `typecheck`, `clean`.
3. Turbo pipeline:
   - `build` depends on upstream `^build`.
   - `test` depends on `build`.
   - `typecheck` depends on upstream `^typecheck`.
4. Runtime baseline:
   - TypeScript implementation.
   - Official support Node `22+`, tested in CI on Node `22` and `24`.

## Test Cases and Acceptance Scenarios
1. Schema validation passes for valid config/lock and fails with actionable errors for invalid fields.
2. Running `apply` twice with unchanged inputs yields zero diff and identical lockfile hash.
3. Shared artifact merge works for multi-contributor `AGENTS.md` and preserves managed section boundaries.
4. Removing one skill removes only its generated fragments and leaves other contributors intact.
5. `apply` without `--prune` never deletes stale artifacts; `apply --prune` deletes only toolkit-managed stale outputs.
6. Unsupported mappings produce warnings, are captured in lock `bindings[].status = "unsupported"`, and do not crash default apply.
7. `--strict` converts unsupported warnings into non-zero exits.
8. Plugin contract tests verify external plugin loading, `apiVersion` compatibility checks, and deterministic output integration.
9. End-to-end fixtures for Codex, Claude, Copilot each validate expected artifact file paths and content hashes.
10. Cross-platform tests validate path normalization and newline consistency.
11. Copilot fixtures validate all four advanced capabilities:
   - Skills in `.github/skills/<skill-name>/SKILL.md`.
   - MCP server entries in `.vscode/mcp.json`.
   - Hook definition files in `.github/hooks/*.json`.
   - Subagent definitions in `.github/agents/*.agent.md`.

## Rollout Plan
1. Milestone 1: Publish `@agent-harness/manifest-schema@1.0.0` with config schema, lock schema, RFC Markdown spec, and examples.
2. Milestone 2: Publish toolkit core with `validate`, `plan`, and `apply` (no pruning yet).
3. Milestone 3: Add full built-in processor set and `--prune`.
4. Milestone 4: Stabilize plugin API with contract test suite and publish `@agent-harness/toolkit@1.0.0`.

## Assumptions and Defaults Chosen
1. v1 scope is Codex + Claude Code + GitHub Copilot.
2. Manifest/lock uses JSON with JSON Schema.
3. Collision handling uses explicit merge matrix in lock artifacts.
4. Toolkit workflow is declarative (`plan`/`apply`) rather than imperative CRUD commands.
5. Lockfile is generated-only and rewritten by toolkit.
6. Unsupported resource/vendor mappings are `warn+skip` by default.
7. Pruning is opt-in via `--prune`.
8. Package naming is scoped: `@agent-harness/manifest-schema` and `@agent-harness/toolkit`.
9. Manifest deliverable is schema + RFC-grade docs.
10. Source config filename defaults to `/Users/tom/Github/agent-harness/agent-harness.config.json`.
11. Lockfile filename defaults to `/Users/tom/Github/agent-harness/agent-harness.lock.json`.

## External Constraints Used for Vendor Conventions
1. [Codex AGENTS.md behavior](https://developers.openai.com/codex/agents-md)
2. [Codex configuration and MCP settings](https://developers.openai.com/codex/config-reference)
3. [Claude settings and file locations](https://docs.claude.com/en/docs/claude-code/settings)
4. [Claude memory file behavior](https://docs.anthropic.com/en/docs/claude-code/memory)
5. [Claude subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
6. [Claude hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
7. [GitHub Copilot custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
8. [VS Code Copilot subagents](https://code.visualstudio.com/docs/copilot/agents/subagents)
9. [GitHub Copilot coding agent hooks](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks)
10. [VS Code Copilot MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
11. [VS Code Copilot agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
12. [npm lockfile semantics reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
13. [pnpm workspace configuration reference](https://pnpm.io/workspaces)
14. [Turborepo repository structuring guidance](https://turbo.build/repo/docs/crafting-your-repository/structuring-a-repository)
