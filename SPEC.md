# Agent Harness v1 Spec: Manifest-First Monorepo (Turborepo + pnpm)

## Summary
1. Build a monorepo at the project root with two publishable packages: `@agent-harness/manifest-schema` and `@agent-harness/toolkit`.
2. Define a declarative source config (`agent-harness.config.json`) and a generated lock-manifest (`agent-harness.lock.json`) with deterministic semantics similar to lockfiles.
3. Implement a processor pipeline that maps `resource -> vendor processor -> artifact fragments -> merged artifacts`, with explicit collision modeling for shared artifact paths.
4. Ship v1 adapters for Codex, Claude Code, and GitHub Copilot, with unsupported mappings (for genuinely unsupported combinations) handled as warnings and recorded in lock state.
5. Expose a modern TUI-first CLI plus library APIs in v1, and define a public plugin API for external processors.
6. Architecture diagrams for key concepts are available in `docs/diagrams/agent-harness-diagram-*.mmd` for further context.

## Monorepo Layout
| Path | Purpose | Publish |
|---|---|---|
| `package.json` | Root scripts, workspace config, package manager pin | No |
| `pnpm-workspace.yaml` | Workspace package discovery | No |
| `turbo.json` | Task graph (`build`, `test`, `lint`, `typecheck`) | No |
| `packages/manifest-schema` | JSON Schemas + RFC-style spec docs + examples | Yes (`@agent-harness/manifest-schema`) |
| `packages/toolkit` | CLI + core engine + built-in processors | Yes (`@agent-harness/toolkit`) |
| `docs` | Architecture and provider matrix docs | No |

## Public Interfaces and Types (v1)
1. Source config file: `agent-harness.config.json`.
2. Lock-manifest file: `agent-harness.lock.json`.
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
6. Core runtime and lock record types (normative for v1):
```ts
export type DiagnosticSeverity = "info" | "warning" | "error";
export type ResourceStatus = "resolved" | "cached" | "failed";
export type BindingStatus = "applied" | "unsupported" | "skipped" | "failed";
export type MergeStrategy =
  | "single_owner_replace"
  | "ordered_concat"
  | "json_object_merge"
  | "managed_sections";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  hint?: string;
  resourceId?: string;
  bindingId?: string;
  vendor?: VendorId;
}

export interface BindingRecord {
  bindingId: string;
  resourceId: string;
  vendor: VendorId;
  processorId: string;
  status: BindingStatus;
  fragmentIds: string[];
}

export interface ArtifactFragment {
  fragmentId: string;
  bindingId: string;
  resourceId: string;
  artifactPath: string;
  mergeStrategy: MergeStrategy;
  fragmentKey: string;
  priority: number;
  contentSha256: string;
}
```

## Manifest Model (Lockfile) Specification
1. `agent-harness.lock.json` is generated-only. Toolkit is authoritative writer.
2. Top-level required fields:
   - `$schema` (URL to schema in `@agent-harness/manifest-schema`)
   - `lockfileVersion` (integer, starts at `1`)
   - `generatedAt` (ISO timestamp of the last semantic lock change)
   - `generatedBy` (`toolkitVersion`, `nodeVersion`, `platform`)
   - `configFingerprint` (sha256 of canonicalized source config + resolved plugin identities)
   - `vendors` (resolved vendor set and adapter versions)
   - `resources` (canonicalized resource instances with content hashes)
   - `bindings` (resource/vendor/processor execution records)
   - `artifacts` (final outputs + contribution matrix)
   - `diagnostics` (warnings/errors snapshot)
3. Key relation objects and minimum record shapes:
   - `vendors[]`: `{ vendorId, adapterVersion, processorIds[] }`.
   - `resources[]`: `{ id, type, status, source, specimen }`.
   - `bindings[]`: `{ bindingId, resourceId, vendor, processorId, status, fragmentIds[] }`.
   - `artifacts[]`: `{ artifactId, path, mergeStrategy, contentSha256, contributors[] }`.
   - `artifacts[].contributors[]`: `{ bindingId, fragmentId, fragmentKey, ownerKey, sectionKey?, byteStart?, byteEnd? }`.
   - `diagnostics[]`: `{ code, severity, message, hint?, resourceId?, bindingId?, vendor? }`.
4. Status semantics are entity-specific:
   - `resources[].status`: `resolved|cached|failed`.
   - `bindings[].status`: `applied|unsupported|skipped|failed`.
   - `unsupported` is valid only on `bindings[]`, never on `resources[]`.
5. Determinism rules:
   - Stable key ordering in JSON serialization.
   - Stable list sorting by deterministic IDs.
   - Path normalization to POSIX relative paths.
   - UTF-8 + `\n` line endings for managed outputs.
   - `configFingerprint` canonicalization profile is:
     - apply schema defaults;
     - normalize all paths to POSIX relative paths;
     - recursively sort object keys lexicographically;
     - sort unordered sets deterministically (`vendors` by `vendorId`, `resources` by `id`, each resource `targets` lexicographically, and `plugins` by package name);
     - serialize as UTF-8 JSON without insignificant whitespace and hash with sha256.
   - No-op `apply` must preserve lock bytes exactly, including `generatedAt`, so repeated unchanged applies produce identical lockfile hash.
   - Resource `source.retrievedAt` is updated only when a remote source is actually refreshed/materialized (not when reused from lock/cache).
6. Lock drift policy:
   - Manual lock edits are detected (fingerprint mismatch).
   - `apply` rewrites lock from computed state.
   - Diagnostic severity is warning by default, error under `--strict`.

## Source Config Specification
1. File: `agent-harness.config.json`.
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
   - `source` (typed source reference object; see `RESOURCES.SPEC.md`)
   - `targets` (vendor IDs)
5. Resource object optional fields:
   - `options` (vendor-specific overrides; default `{}`)
   - `priority` (integer, default `100`; lower number merges earlier)
   - `enabled` (boolean, default `true`)
6. Policy semantics (v1):
   - `policy.unsupported`: `warn|error|ignore` (default `warn`).
   - `policy.pruneDefault`: boolean (default `false`).
   - `policy.conflictMode`: only `error` is valid in v1 (default `error`; other values are schema errors reserved for future versions).

## Processing Pipeline (Toolkit Core)
1. Parse and schema-validate config.
2. Resolve and normalize sources into vendor-neutral resource specimens, then compute specimen hashes.
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
4. Deterministic fragment ordering for all merge strategies:
   - primary key: `resource.priority` ascending.
   - secondary key: `resource.id` lexicographic.
   - tertiary key: `bindingId` lexicographic.
   - quaternary key: `fragmentId` lexicographic.
5. Strategy semantics:
   - `single_owner_replace`: exactly one distinct owner per artifact; multiple non-identical owners are conflicts.
   - `ordered_concat`: concatenate ordered fragments with `\n` separators and normalize final file to exactly one trailing `\n`.
   - `json_object_merge`: deep object merge by sorted keys; key collisions are conflicts under `policy.conflictMode = "error"`.
   - `managed_sections`: required for shared Markdown/text artifacts (for example `AGENTS.md`) and uses explicit section markers.
6. `managed_sections` marker contract:
   - start marker: `<!-- agent-harness:start section=<sectionKey> owner=<ownerKey> -->`
   - end marker: `<!-- agent-harness:end section=<sectionKey> -->`
   - `ownerKey = <resourceId>::<fragmentKey>`
   - `sectionKey = sha256(<artifactId> + "\0" + <ownerKey>).slice(0, 16)`
7. Conflict rules:
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
| `environment_config` | Supported (`.codex/config.toml`, e.g. `shell_environment_policy`) | Supported (`.claude/settings.json` env) | Unsupported in built-in v1 (warn+skip) |
| `subagent` | Unsupported in built-in v1 (warn+skip) | Supported (`.claude/agents/...`) | Supported (`.github/agents/*.agent.md`) |

## CLI Specification
1. `agent-harness` (no subcommand)
   - Launches the interactive TUI mode by default.
   - Supports guided flows for plan/apply/diff and resource diagnostics.
2. `agent-harness validate`
   - Validates config and existing lockfile.
   - Exit `0` on valid, `1` on schema or structural errors.
3. `agent-harness plan`
   - Computes operations and diagnostics, no writes.
   - Supports `--json` for machine-readable plan output.
4. `agent-harness apply`
   - Writes generated artifacts and lockfile.
   - Supports `--prune`, `--strict`, `--dry-run`, `--refresh`, `--offline`.
5. `agent-harness diff`
   - Shows desired-vs-current delta based on lock and filesystem.
6. Common flags:
   - `--config <path>`
   - `--lockfile <path>`
   - `--cwd <path>`
   - `--no-tui` (force plain non-interactive output)
   - `--json` (machine-readable mode for CI/integration)

## TUI Framework Decision (v1)
1. Framework choice: `ink` (React-based terminal UI for Node.js) as the primary TUI runtime.
2. Current recency check (npm registry):
   - `ink@6.6.0`, package metadata modified on **December 22, 2025**.
3. Optional companion for lightweight prompt-only flows: `@clack/prompts`.
4. Why this choice:
   - Rich component model for complex terminal interfaces.
   - Strong fit for stateful multi-pane workflows (`plan`, `diff`, diagnostics).
   - Works alongside non-interactive command mode (`--no-tui` / `--json`) for CI.
5. Required UX contract:
   - TUI mode must never be required in CI.
   - All TUI actions map to equivalent non-TUI subcommands.
   - Error diagnostics are identical between TUI and non-TUI paths.

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
2. Running `apply` twice with unchanged inputs yields zero diff and byte-identical lockfile (including unchanged `generatedAt`).
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
12. TUI smoke tests validate:
   - Default `agent-harness` launches interactive mode in TTY contexts.
   - `--no-tui` and `--json` bypass TUI deterministically.
   - TUI and non-TUI execution produce equivalent plan/apply outcomes.
13. Remote source controls validate:
   - `apply --refresh` re-materializes remote sources and updates `source.retrievedAt`.
   - `apply --offline` uses only lock+cache and fails if required cache entries are absent.

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
10. Source config filename defaults to `agent-harness.config.json`.
11. Lockfile filename defaults to `agent-harness.lock.json`.
12. CLI UX is TUI-first for humans, with required non-TUI parity for automation.
13. `skills_package` is defined as command-backed with `executor: "npx"` and no standalone `ref` field in v1.

## External Constraints Used for Vendor Conventions
### Codex (OpenAI)
1. [Codex AGENTS.md behavior](https://developers.openai.com/codex/agents-md)
2. [Codex configuration and MCP settings](https://developers.openai.com/codex/config-reference)
3. [Codex config basics (including environment policy)](https://developers.openai.com/codex/config-basic/)

### Claude Code (Anthropic)
4. [Claude settings and file locations](https://docs.claude.com/en/docs/claude-code/settings)
5. [Claude memory file behavior](https://docs.anthropic.com/en/docs/claude-code/memory)
6. [Claude subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
7. [Claude hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)

### GitHub Copilot / VS Code (Updated)
8. [GitHub Copilot custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
9. [VS Code Copilot subagents](https://code.visualstudio.com/docs/copilot/agents/subagents)
10. [GitHub Copilot coding agent hooks](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks)
11. [VS Code Copilot MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
12. [VS Code Copilot agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

### Tooling References
13. [npm lockfile semantics reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
14. [pnpm workspace configuration reference](https://pnpm.io/workspaces)
15. [Turborepo repository structuring guidance](https://turbo.build/repo/docs/crafting-your-repository/structuring-a-repository)
16. [Ink repository (React for CLI)](https://github.com/vadimdemedes/ink)
17. [Ink package on npm](https://www.npmjs.com/package/ink)
18. [Clack prompts package](https://www.npmjs.com/package/@clack/prompts)
