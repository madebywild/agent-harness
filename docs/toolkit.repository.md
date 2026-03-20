# `packages/toolkit/src/repository.ts`

## Purpose

Encapsulates filesystem persistence/parsing for manifest, lock, managed-index, sidecar overrides, and source scanning.

## Exported APIs

- Manifest I/O: `loadManifest`, `writeManifest`
- Lock I/O: `loadLock`, `writeLock`
- Managed index I/O: `emptyManagedIndex`, `loadManagedIndex`, `writeManagedIndex`
- Sidecar parser: `readProviderOverrideFile` (accepts optional `envVars` map for placeholder substitution)
- Filesystem helpers: `listFilesRecursively`, `collectSourceCandidates`, `collectManagedSourcePaths`, `removeIfExists`, `copyWorkspaceFileToBackup`

## Diagnostics produced here

- `MANIFEST_NOT_FOUND`, `MANIFEST_INVALID`
- `LOCK_INVALID`
- `MANAGED_INDEX_INVALID`
- `OVERRIDE_INVALID`
- version diagnostics (per file kind): `*_VERSION_OUTDATED`, `*_VERSION_NEWER_THAN_CLI`, `*_VERSION_MISSING`, `*_VERSION_INVALID`

## Ownership helpers

`collectSourceCandidates` scans `.harness/src` and returns known candidate source files:

- prompt markdown
- skill `SKILL.md`
- MCP JSON
- subagent markdown
- hook JSON
- prompt/skill/MCP/subagent/hook override sidecar YAMLs

`collectManagedSourcePaths` derives registered managed paths from manifest entities (`sourcePath` + `overrides[provider]`) using strict relative normalization:

- no absolute paths
- no Windows drive-prefixed paths
- no `..` segments
- no `"."` aliases
