# `packages/toolkit/src/paths.ts`

## Purpose

Centralizes path conventions for `.harness` workspace files and canonical source paths.

## Key exports

- `HarnessPaths`: resolved absolute path set for workspace files/directories, including `promptSectionDir`, `hookDir`, `presetsDir`, `importsDir`, `skillImportDir`, `envFile`, and `rootEnvFile`.
- `resolveHarnessPaths(rootDir)`: computes absolute paths for `.harness` files.

Env file paths:

- `envFile`: `.harness/.env` (project-specific secrets, highest priority)
- `rootEnvFile`: `.env.harness` at project root (shared parameters, lower priority)

Source path helpers:

- `defaultPromptSectionSourcePath(id)` → `.harness/src/prompt-sections/<id>/SECTION.md`
- `defaultSkillSourcePath(skillId)`
- `defaultMcpSourcePath(id)`
- `defaultSubagentSourcePath(id)`
- `defaultHookSourcePath(id)`
- `defaultSettingsSourcePath(provider)` — returns `.harness/src/settings/codex.toml` for codex, `.harness/src/settings/<provider>.json` for others.
- `defaultCommandSourcePath(id)`
- `defaultSkillImportMetadataPath(skillId)` → `.harness/imports/skills/<id>.json`

Override path helpers:

- `defaultPromptSectionOverridePath(id, provider)` → `.harness/src/prompt-sections/<id>/OVERRIDES.<provider>.yaml`
- `defaultSkillOverridePath(skillId, provider)`
- `defaultMcpOverridePath(id, provider)`
- `defaultSubagentOverridePath(id, provider)`
- `defaultHookOverridePath(id, provider)`
- `defaultCommandOverridePath(id, provider)`

## Contract

These helpers encode the filesystem contract; loader and engine logic assume these defaults when explicit override paths are not provided in manifest entities.
