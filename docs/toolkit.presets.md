# Preset modules

## Purpose

Implements the preset system: discovery, resolution, and application of bootstrap macros that materialize normal harness state.

## Module layout

- `presets.ts`: resolution and listing logic (`resolvePreset`, `listBuiltinPresets`, `listLocalPresets`, `listRegistryPresets`, `summarizePreset`).
- `preset-builtin.ts`: `BUILTIN_PRESETS` constant — the four bundled preset definitions with embedded content.
- `preset-packages.ts`: filesystem reader for preset package directories (`readPresetPackageFromDir`, `listPresetDirectories`).
- `engine/presets.ts`: `applyResolvedPreset` — applies a resolved preset's operations against a workspace.

## Preset sources

| Source | Location | Discovery |
| --- | --- | --- |
| Builtin | Compiled into the toolkit package | Always available |
| Local | `.harness/presets/<id>/` | Available when workspace exists |
| Registry | `presets/<id>/` in a git registry | Requires configured registry |

## Resolution order

`resolvePreset(cwd, { presetId, manifest?, registry? })`:

1. If `registry` is provided, fetch from that git registry.
2. Look up builtin presets by id.
3. Look up local presets in `.harness/presets/<id>/`.
4. Throw `PRESET_NOT_FOUND` if none match.

## Bundled presets

| ID | Name | Description |
| --- | --- | --- |
| `delegate` | Delegated Prompt Init | Enables all providers + seeds a bootstrap prompt for delegated authoring. |
| `starter` | Starter Workspace | Enables all providers + adds a prompt, `reviewer` skill, and `fix-issue` command. |
| `researcher` | Research Assistant | Enables all providers + adds a prompt and `research-assistant` subagent. |
| `yolo` | YOLO Mode | Enables all providers + adds a prompt and permissive settings for all providers. |

## Preset application (`applyResolvedPreset`)

Processes operations sequentially. Each operation type:

- `register_registry` — adds registry entry to manifest (skips if identical, throws on conflict).
- `enable_provider` — appends to `providers.enabled` (skips if already present).
- Entity adds (`add_prompt`, `add_skill`, `add_mcp`, `add_subagent`, `add_hook`, `add_settings`, `add_command`) — delegates to the standard `add*Entity` functions. Skips if entity already exists with matching content/provenance; throws `PRESET_CONFLICT` on mismatch.

Re-reads manifest after each mutation to avoid stale state.

## Preset package format

A preset package directory contains:

- `preset.json` — required, validated against `presetDefinitionSchema`.
- `prompt.md` — optional embedded prompt.
- `skills/<id>/**` — optional embedded skill directories.
- `mcp/<id>.json` — optional embedded MCP configs.
- `subagents/<id>.md` — optional embedded subagents.
- `hooks/<id>.json` — optional embedded hooks.
- `settings/<provider>.json` or `settings/codex.toml` — optional embedded settings.
- `commands/<id>.md` — optional embedded commands.

Settings file format is derived from `defaultSettingsSourcePath()` in `paths.ts` — currently `codex` uses TOML, all others use JSON.
