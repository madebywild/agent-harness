# `packages/toolkit/src/loader.ts`

## Purpose

Loads canonical entities from `.harness/src`, validates manifest semantics, and produces normalized in-memory models for planning.

## Exported APIs

- `loadCanonicalState(paths, manifest)`
- `validateManifestSemantics(manifest)`

## `loadCanonicalState` responsibilities

- Validates manifest semantic constraints.
- Scans `.harness/src` candidate files and raises `SOURCE_UNREGISTERED` for unmanaged candidates.
  - Candidate set includes canonical entity files plus provider override sidecars.
- Loads enabled prompt/skill/MCP/subagent entities.
- Parses provider override sidecars for each provider and records override SHA hashes.
- Returns loaded skill/MCP/subagent collections sorted by `entity.id`.

## Entity loading behavior

- Prompt:
  - reads markdown (`gray-matter`), validates non-empty body (`PROMPT_EMPTY`), captures frontmatter.
- Skill:
  - loads all files under the skill directory, excluding `OVERRIDES.<provider>.yaml` sidecars from canonical skill payload.
  - requires presence of `SKILL.md` (`SKILL_MARKDOWN_MISSING`).
- MCP:
  - requires JSON object input (`MCP_JSON_INVALID` on parse/type failures).
- Subagent:
  - reads markdown with YAML frontmatter (`gray-matter`).
  - requires non-empty `name`, `description`, and body (`SUBAGENT_*` diagnostics).
  - allows additional frontmatter keys as metadata.
  - warns on unknown provider override options (`SUBAGENT_OPTIONS_UNKNOWN`).

## Manifest semantic checks

- Duplicate provider IDs (`PROVIDER_DUPLICATE`).
- Required built-in `local` registry exists and has `type: "local"` (`REGISTRY_NOT_FOUND`).
- `registries.default` must reference a defined registry (`REGISTRY_DEFAULT_INVALID`).
- Entity `registry` must reference a defined registry (`REGISTRY_NOT_FOUND`).
- Git registry `tokenEnvVar` must be a valid env-var identifier (`REGISTRY_INVALID`).
- Duplicate entity IDs (`ENTITY_ID_DUPLICATE`).
- Prompt entity ID must be `system` (`PROMPT_ID_INVALID`).
- Enforced source paths by entity type (`PROMPT_SOURCE_INVALID`, `SKILL_SOURCE_INVALID`, `MCP_SOURCE_INVALID`, `SUBAGENT_SOURCE_INVALID`).
- At most one prompt entity (`PROMPT_COUNT_INVALID`).
- Warns when entities are present but no providers are enabled (`NO_PROVIDERS_ENABLED`).
