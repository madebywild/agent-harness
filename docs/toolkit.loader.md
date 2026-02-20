# `packages/toolkit/src/loader.ts`

## Purpose

Loads canonical entities from `.harness/src`, validates manifest semantics, and produces normalized in-memory models for planning.

## Exported APIs

- `loadCanonicalState(paths, manifest)`
- `validateManifestSemantics(manifest)`

## `loadCanonicalState` responsibilities

- Validates manifest semantic constraints.
- Scans `.harness/src` candidate files and raises `SOURCE_UNREGISTERED` for unmanaged candidates.
- Loads enabled prompt/skill/MCP entities.
- Parses provider override sidecars for each provider and records override SHA hashes.

## Entity loading behavior

- Prompt:
  - reads markdown (`gray-matter`), validates non-empty body (`PROMPT_EMPTY`), captures frontmatter.
- Skill:
  - loads all files under the skill directory, excluding `OVERRIDES.<provider>.yaml` sidecars from canonical skill payload.
  - requires presence of `SKILL.md` (`SKILL_MARKDOWN_MISSING`).
- MCP:
  - requires JSON object input (`MCP_JSON_INVALID` on parse/type failures).

## Manifest semantic checks

- Duplicate provider IDs (`PROVIDER_DUPLICATE`).
- Duplicate entity IDs (`ENTITY_ID_DUPLICATE`).
- Prompt entity ID must be `system` (`PROMPT_ID_INVALID`).
- Enforced source paths by entity type (`PROMPT_SOURCE_INVALID`, `SKILL_SOURCE_INVALID`, `MCP_SOURCE_INVALID`).
- At most one prompt entity (`PROMPT_COUNT_INVALID`).
