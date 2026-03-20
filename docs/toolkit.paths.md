# `packages/toolkit/src/paths.ts`

## Purpose

Centralizes path conventions for `.harness` workspace files and canonical source paths.

## Key exports

- `HarnessPaths`: resolved absolute path set for workspace files/directories, including `hookDir`.
- `resolveHarnessPaths(rootDir)`: computes absolute paths for `.harness` files.
- `DEFAULT_PROMPT_SOURCE_PATH`: `.harness/src/prompts/system.md`.

Source path helpers:

- `defaultSkillSourcePath(skillId)`
- `defaultMcpSourcePath(id)`
- `defaultSubagentSourcePath(id)`
- `defaultHookSourcePath(id)`

Override path helpers:

- `defaultPromptOverridePath(provider)`
- `defaultSkillOverridePath(skillId, provider)`
- `defaultMcpOverridePath(id, provider)`
- `defaultSubagentOverridePath(id, provider)`
- `defaultHookOverridePath(id, provider)`

## Contract

These helpers encode the filesystem contract; loader and engine logic assume these defaults when explicit override paths are not provided in manifest entities.
