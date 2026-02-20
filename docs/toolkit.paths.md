# `packages/toolkit/src/paths.ts`

## Purpose

Centralizes all path conventions for `.harness` workspace files and canonical source paths.

## Key exports

- `HarnessPaths`: resolved absolute path set for workspace files/directories.
- `resolveHarnessPaths(rootDir)`: computes absolute paths for `.harness` files.
- `DEFAULT_PROMPT_SOURCE_PATH`: `.harness/src/prompts/system.md`.
- Override path helpers:
  - `defaultPromptOverridePath(provider)`
  - `defaultSkillOverridePath(skillId, provider)`
  - `defaultMcpOverridePath(id, provider)`
- Source path helpers:
  - `defaultSkillSourcePath(skillId)`
  - `defaultMcpSourcePath(id)`

## Contract

These helpers encode the v1 filesystem contract; loader and engine logic assume these defaults when explicit override paths are not provided in manifest entities.
