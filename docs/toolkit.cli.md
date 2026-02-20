# `packages/toolkit/src/cli.ts`

## Purpose

Defines the `agent-harness` CLI using Commander and maps CLI commands to `HarnessEngine` methods.

## Commands

- `init [--force]`: initialize `.harness`; `--force` overwrites an existing workspace.
- `provider enable <provider>`: enable `codex`, `claude`, or `copilot`.
- `provider disable <provider>`: disable a provider.
- `add prompt|skill|mcp`: scaffold source entities.
- `remove <prompt|skill|mcp> <id> [--delete-source]`: remove an entity from manifest and optionally delete source files.
- `validate`: print diagnostics and set exit code `1` if invalid.
- `plan [--json]`: show proposed file operations and diagnostics.
- `apply [--json]`: execute write/delete operations if no error diagnostics.
- `watch [--debounce <ms>]`: run apply loop on source changes.

## Behavior notes

- Global option: `--cwd <path>` sets workspace root.
- Default action (no subcommand) runs `plan` and prints operations and diagnostics.
- All command failures are funneled through `program.parseAsync(...).catch(...)` and exit with code `1`.
