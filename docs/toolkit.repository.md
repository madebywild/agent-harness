# `packages/toolkit/src/repository.ts`

## Purpose

Encapsulates filesystem persistence/parsing for manifest, lock, managed-index, sidecar overrides, and source scanning.

## Exported APIs

- Manifest I/O: `loadManifest`, `writeManifest`
- Lock I/O: `loadLock`, `writeLock`
- Managed index I/O: `emptyManagedIndex`, `loadManagedIndex`, `writeManagedIndex`
- Sidecar parser: `readProviderOverrideFile` (accepts an optional `SubstitutionContext` with env vars and behavior values for placeholder substitution)
- `ensureHarnessGitignore(paths)`: writes `.harness/.gitignore` (ignoring `.env` and `behavior.yaml`) when absent, and returns whether it created the file; an existing file is left untouched because it then belongs to the project
- Filesystem helpers: `listFilesRecursively`, `collectSourceCandidates`, `collectManagedSourcePaths`, `removeIfExists`, `copyWorkspaceFileToBackup`

## Diagnostics produced here

- `MANIFEST_NOT_FOUND`, `MANIFEST_INVALID`
- `PROMPT_ENTITY_REMOVED` — the legacy `prompt` entity was replaced by composable `prompt_section` entities. When a manifest still contains a `type: "prompt"` entity, this actionable error is surfaced (move `.harness/src/prompts/<id>.md` to `.harness/src/prompt-sections/<id>/SECTION.md`, rename override sidecars to `OVERRIDES.<provider>.yaml`, and change the entity `type` to `prompt_section` — composition order follows the entities array). No automatic migration is provided; the schema version is not bumped. Detection is shared by `detectLegacyPromptEntity`: the doctor version-preflight (`inspectParsedVersionedObject`) checks for it before schema parsing so `plan`/`apply`/`validate`/`doctor` all report `PROMPT_ENTITY_REMOVED` instead of a cryptic Zod discriminated-union `MANIFEST_INVALID`; `loadManifest` also detects it for any path that bypasses the preflight.
- `LOCK_INVALID`
- `MANAGED_INDEX_INVALID`
- `OVERRIDE_INVALID`
- version diagnostics (per file kind): `*_VERSION_OUTDATED`, `*_VERSION_NEWER_THAN_CLI`, `*_VERSION_MISSING`, `*_VERSION_INVALID`

## Ownership helpers

`collectSourceCandidates` scans `.harness/src` and returns known candidate source files:

- prompt-section `SECTION.md`
- skill `SKILL.md`
- MCP JSON
- subagent markdown
- hook JSON
- prompt-section/skill/MCP/subagent/hook override sidecar YAMLs

`collectManagedSourcePaths` derives registered managed paths from manifest entities (`sourcePath` + `overrides[provider]`) using strict relative normalization:

- no absolute paths
- no Windows drive-prefixed paths
- no `..` segments
- no `"."` aliases
