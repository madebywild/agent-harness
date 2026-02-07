# Agent Harness Resource Specification (v1)

## Summary
This document defines the resource layer for Agent Harness: where resources come from, how they are normalized, and how they are resolved deterministically into vendor processors and artifacts.

This spec extends `SPEC.md` and focuses only on resource modeling and source resolution.
Architecture diagrams for key concepts are available in `docs/diagrams/agent-harness-diagram-*.mmd` for further context.

## Goals
1. Support both local and remote resource sources.
2. Support CLI-backed resource acquisition (for ecosystems like `npx skills`), without sacrificing reproducibility.
3. Keep lockfile behavior deterministic, debuggable, and safe to prune.
4. Make resource removal precise (delete only owned generated fragments).

## Non-Goals (v1)
1. Full package-manager features (dependency graphs, semver solving).
2. Arbitrary executable plugin scripts during source resolution.
3. Cross-resource templating/macro language.

## Naming Decisions
1. `Resource Entry`: user-authored declaration in `agent-harness.config.json`.
2. `Source Reference`: where raw input is fetched from.
3. `Resource Specimen`: canonical normalized representation consumed by processors.
4. `Executable Descriptor`: canonical command descriptor for executable-backed sources.

`Resource Specimen` is the key term for predictability: processors never read raw sources directly, only normalized specimens.

## Resource Entry Schema (v1)
Each `resources[]` item in config must include:

```json
{
  "id": "string (unique)",
  "type": "skill|mcp_server|system_prompt|lifecycle_hook|environment_config|subagent",
  "source": { "kind": "..." },
  "targets": ["codex", "claude", "copilot"]
}
```

Rules:
1. `id` must be unique and stable across edits.
2. Optional `options` defaults to `{}`.
3. Optional `priority` default is `100`; lower number means earlier merge contribution.
4. Optional `enabled=false` keeps the entry in config but excludes it from plan/apply.

## Source Reference Kinds
The toolkit supports the following source kinds in v1.

### 1) `inline_text`
For short embedded text payloads.

```json
{
  "kind": "inline_text",
  "content": "..."
}
```

### 2) `local_file`
For a single local file.

```json
{
  "kind": "local_file",
  "path": ".agent-harness/resources/system-prompt.md"
}
```

### 3) `local_dir`
For directory-shaped resources (for example skill packages).

```json
{
  "kind": "local_dir",
  "path": ".agent-harness/resources/skills",
  "include": ["**/*"],
  "exclude": ["**/.DS_Store", "**/node_modules/**"]
}
```

### 4) `git_repo`
For repository-backed sources (immutable after resolution).

```json
{
  "kind": "git_repo",
  "url": "https://github.com/org/repo",
  "ref": "main",
  "subpath": "skills",
  "depth": 1
}
```

### 5) `http_file` / `http_archive`
For direct URL resources.

```json
{
  "kind": "http_file",
  "url": "https://example.com/prompt.md",
  "sha256": "optional-but-recommended"
}
```

```json
{
  "kind": "http_archive",
  "url": "https://example.com/resources.tar.gz",
  "subpath": "skills",
  "sha256": "optional-but-recommended"
}
```

### 6) `skills_package` (first-class)
This is the preferred way to integrate the Skills ecosystem (Vercel/open standard style).
In v1, this source kind is explicitly command-backed and maps to `npx skills add ...`.

```json
{
  "kind": "skills_package",
  "executor": "npx",
  "locator": "vercel-labs/agent-skills",
  "skills": ["react-best-practices", "web-design-guidelines"]
}
```

`locator` accepts:
1. GitHub shorthand (`owner/repo`)
2. Full GitHub URL
3. GitLab URL
4. Any git URL
5. Local path

`skills_package` command semantics in v1:
1. Command template: `npx skills add <locator> [--skill <name> ...] --yes`
2. `executor` is required and must be `npx` in v1.
3. There is no standalone `ref` field for `skills_package`.
4. If revision-like targeting is needed, it must be encoded in `locator` form (for example a tree URL), then resolved and pinned in lock metadata/digest.

### 7) `executable_source` (generalized executable bridge)
For sources that must be materialized through an external executable (Node, Python, or binary tools).

```json
{
  "kind": "executable_source",
  "runtime": "node",
  "executable": "npx",
  "package": "skills@1.1.1",
  "args": ["skills", "add", "vercel-labs/agent-skills", "--skill", "react-best-practices", "--yes"],
  "capture": {
    "path": ".codex/skills",
    "mode": "copy"
  },
  "nonInteractive": true
}
```

Example Python-based source descriptor (illustrative):

```json
{
  "kind": "executable_source",
  "runtime": "python",
  "executable": "uvx",
  "package": "agent-skill-fetcher==0.3.2",
  "args": ["agent-skill-fetcher", "pull", "acme/skills", "--format", "dir"],
  "capture": {
    "path": ".agent-harness/cache/skills",
    "mode": "copy"
  },
  "nonInteractive": true
}
```

Constraints:
1. `runtime`, `executable`, `args`, `capture.path`, and `nonInteractive=true` are required.
2. Version pinning is required via `package` (or equivalent executable digest in future extension).
3. Command runs in an isolated temp workspace, never directly in project root.
4. Output is captured, normalized, and hashed before specimen conversion.

## Source Kind vs Resource Type Matrix
| Resource Type | Allowed Source Kinds |
|---|---|
| `system_prompt` | `inline_text`, `local_file`, `git_repo`, `http_file` |
| `skill` | `local_dir`, `git_repo`, `http_archive`, `skills_package`, `executable_source` |
| `mcp_server` | `inline_text`, `local_file`, `git_repo`, `http_file` |
| `lifecycle_hook` | `inline_text`, `local_file`, `git_repo`, `http_file` |
| `environment_config` | `inline_text`, `local_file`, `git_repo`, `http_file` |
| `subagent` | `local_file`, `local_dir`, `git_repo`, `http_archive` |

## Resource Resolution Pipeline
1. Parse config and validate source kind against resource type.
2. Resolve source reference into a local materialization cache.
3. Normalize line endings (`\n`), path separators (`/`), and file ordering.
4. Parse into a typed resource specimen.
5. Validate specimen schema and type-specific invariants.
6. Compute specimen digest (`sha256`) over canonical bytes.
7. Record source resolution + specimen metadata in lockfile.
8. Pass specimens to vendor processors.

## Canonical Resource Specimens
Processors consume typed specimens, not raw sources:

1. `SystemPromptSpecimen`
   - `format`: `markdown|text`
   - `content`
   - `contentSha256`
2. `SkillPackageSpecimen`
   - `skills[]` each with `name`, `description`, `path`, `files[]`, `digest`
   - validates `SKILL.md` frontmatter requirements when present
3. `McpServerSpecimen`
   - normalized server map
4. `LifecycleHookSpecimen`
   - normalized hook descriptors (`event`, `matcher`, `action`, `timeout`)
5. `EnvironmentConfigSpecimen`
   - normalized key/value map plus policy (`inherit`, `allowlist`, `denylist`)
6. `SubagentSpecimen`
   - agent metadata + instruction body + optional attachments
7. Specimen portability rule:
   - specimens are vendor-neutral canonical models;
   - vendor-specific file shape and syntax adaptation happens only in processor transforms.

## Lockfile Requirements for Resources
Each resolved resource in `agent-harness.lock.json` must include:

```json
{
  "id": "resource-id",
  "type": "skill",
  "source": {
    "kind": "skills_package",
    "executor": "npx",
    "locator": "vercel-labs/agent-skills",
    "normalizedCommand": "npx skills add vercel-labs/agent-skills --skill react-best-practices --yes",
    "commandFingerprint": "<sha256>",
    "retrieval": "executable",
    "retrievedAt": "2026-02-06T00:00:00.000Z"
  },
  "specimen": {
    "kind": "SkillPackageSpecimen",
    "digestSha256": "<digest>",
    "files": [{ "path": "skills/react-best-practices/SKILL.md", "sha256": "<digest>" }]
  },
  "status": "resolved|cached|failed"
}
```

Determinism rules:
1. Remote sources must have content digest in lock.
2. For git/http sources, `resolvedRef` is recorded when discoverable.
3. Lock ordering is stable by `resource.id`.
4. For `executable_source`, lock must also include:
   - `runtime`
   - `executable`
   - `package` (or pinned executable identity)
   - `commandFingerprint` (sha256 of executable descriptor)
5. For `skills_package`, lock must include:
   - `executor` (`npx` in v1)
   - `normalizedCommand`
   - `commandFingerprint`
6. `unsupported` status is recorded at binding level (`bindings[].status`) and is not a valid `resources[].status` value.

## Reproducibility and Update Policy
1. Default `plan/apply` behavior uses lock-pinned resolutions if available.
2. If lock is missing for a remote source, resolve once and persist pin.
3. Drift detection:
   - if resolved content hash changes unexpectedly, emit warning;
   - with `--strict`, fail.
4. Remote refresh requires explicit intent (`apply --refresh` in toolkit CLI design).
5. Offline mode:
   - uses lock + cache only;
   - fails if required materialization is absent.
6. No-op apply behavior:
   - if a remote resource is reused from lock/cache without re-fetching, preserve prior `source.retrievedAt`;
   - update `source.retrievedAt` only when remote materialization actually runs (initial fetch or explicit refresh).

## `skills_package` and `executable_source` Policy
### Preferred path: `skills_package`
Use this typed wrapper when integrating Skills sources. In v1 it is intentionally explicit that this executes `npx skills add ...`.

### Bridge path: `executable_source`
Use when a source is only realistically installable through a CLI workflow.

`executable_source` hard requirements:
1. Explicit runtime + executable + package/version pin.
2. Explicit capture path.
3. Non-interactive mode.
4. Deterministic descriptor hashing (`commandFingerprint`).
5. Captured output is re-hashed and converted into a specimen.

## Type-Specific Validation Rules
### `skill`
1. Each selected skill directory must contain `SKILL.md`.
2. If YAML frontmatter exists, validate at least `name` and `description`.
3. Skill name must match directory name when standard rules are enabled.
4. Duplicate skill names across one specimen are errors.
5. For `skills_package`, `executor` must be present and equal to `npx` in v1.
6. For `skills_package`, presence of `ref` is a schema error in v1.

### `system_prompt`
1. Empty content is invalid.
2. UTF-8 only.
3. Normalize trailing newline to exactly one newline.

### `mcp_server`
1. Must parse into a vendor-neutral normalized MCP server map specimen.
2. Vendor-specific encoding (for example TOML/JSON file shape) is deferred to processor output, not specimen parsing.
3. Duplicate server IDs in one specimen are errors.

### `lifecycle_hook`
1. Each hook requires deterministic `id`.
2. Event name and action command are required.

### `environment_config`
1. Key collisions inside one specimen are schema errors in v1 (no implicit override mode).
2. Secret-like keys are allowed but must be marked with sensitivity metadata when configured inline.

### `subagent`
1. Must include instruction body.
2. Optional metadata keys normalized to lowercase snake_case in specimen form.

## Merge and Ownership Semantics
1. A single resource may contribute fragments to multiple artifacts.
2. Each artifact contribution stores `resourceId` and `specimenDigest`.
3. On removal, toolkit prunes only fragments owned by removed resource digests.
4. If two resources claim same managed section key with different content, fail with conflict.

## Security Model
1. Allow remote protocols: `https`, `ssh` (git), and local filesystem paths.
2. Disallow `file://` remote indirection and path traversal from archives.
3. For archives, strip absolute paths and `..` segments.
4. `executable_source` execution runs in temp directories with non-interactive mode and never uses project root as cwd.
5. Executable allowlist in v1 is: `npx`, `uvx`, `pipx`; all others are validation errors.
6. `executable_source` execution environment rules:
   - inherit only minimal safe environment (`PATH`, `HOME`, `TMPDIR`, locale vars);
   - no interactive stdin;
   - bounded execution timeout with diagnostic on timeout.
7. Store provenance for every executable-backed resolution: `runtime`, `executable`, `package`, `commandFingerprint`, `digest`.

## Deferred for Later
1. Detailed failure semantics (retry policies, partial capture classification, backoff strategies) are intentionally deferred beyond v1 resource spec.

## Diagnostics
Resource diagnostics must include:
1. `code` (`RESOURCE_SOURCE_UNRESOLVED`, `RESOURCE_DIGEST_MISMATCH`, `RESOURCE_TYPE_INVALID_SOURCE`, etc.)
2. `resourceId`
3. `source.kind`
4. `severity`
5. actionable fix hint

## Test Scenarios (Decision-Complete)
1. Local file prompt resolves to identical digest across runs.
2. Git source with branch ref pins to commit SHA in lock.
3. `skills_package` locator accepts GitHub shorthand and URL forms.
4. `skills_package` maps to normalized command `npx skills add ... --yes`.
5. `skills_package` with selected subset installs only listed skills.
6. `skills_package` with `ref` field fails schema validation.
7. `executable_source` with Node (`npx`) captures outputs deterministically.
8. `executable_source` with Python launcher (`uvx` or `pipx`) resolves into deterministic specimen output.
9. Offline apply succeeds with warm cache and fails with missing cache.
10. Digest mismatch triggers warning; strict mode fails.
11. Removing one resource deletes only owned managed sections.
12. Duplicate skill names in one specimen fail validation.
13. Archive traversal attempt is rejected.

## Defaults Chosen (v1)
1. Preferred source model is typed `Source Reference` objects, not a single URI string.
2. `skills_package` is a first-class command-backed source with `executor: "npx"` and no `ref` field in v1.
3. `executable_source` is supported for extensibility across runtimes.
4. Remote sources are lock-pinned with digest and resolved revision (when discoverable).
5. Processors operate only on normalized specimens.

## References
1. [Vercel Skills repository (`npx skills`) with source format and options](https://github.com/vercel-labs/skills)
2. [Skills CLI docs](https://skills.sh/docs/cli)
3. [Agent Skills format specification](https://agentskills.io/specification)
4. [Codex AGENTS.md guidance](https://developers.openai.com/codex/agents-md)
5. [Codex config reference](https://developers.openai.com/codex/config-reference)
6. [Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings)
7. [GitHub Copilot custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
