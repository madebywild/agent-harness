# `packages/toolkit/src/paths.ts`

## Purpose

Centralizes path conventions for `.harness` workspace files and canonical source paths.

## Key exports

- `HarnessPaths`: resolved absolute path set for workspace files/directories, including `hookDir`, `presetsDir`, `envFile`, and `rootEnvFile`.
- `resolveHarnessPaths(rootDir)`: computes absolute paths for `.harness` files.
- `DEFAULT_PROMPT_SOURCE_PATH`: `.harness/src/prompts/system.md`.

Env file paths:

- `envFile`: `.harness/.env` (project-specific secrets, highest priority)
- `rootEnvFile`: `.env.harness` at project root (shared parameters, lower priority)

Source path helpers:

- `defaultSkillSourcePath(skillId)`
- `defaultMcpSourcePath(id)`
- `defaultSubagentSourcePath(id)`
- `defaultHookSourcePath(id)`
- `defaultSettingsSourcePath(provider)` — returns `.harness/src/settings/codex.toml` for codex, `.harness/src/settings/<provider>.json` for others.
- `defaultCommandSourcePath(id)`

Override path helpers:

- `defaultPromptOverridePath(provider)`
- `defaultSkillOverridePath(skillId, provider)`
- `defaultMcpOverridePath(id, provider)`
- `defaultSubagentOverridePath(id, provider)`
- `defaultHookOverridePath(id, provider)`
- `defaultCommandOverridePath(id, provider)`

## Contract

These helpers encode the filesystem contract; loader and engine logic assume these defaults when explicit override paths are not provided in manifest entities.
