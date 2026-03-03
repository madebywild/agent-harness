# `packages/toolkit/src/cli.ts`

## Purpose

Defines the `harness` CLI using Commander and maps CLI commands to `HarnessEngine` methods.

## Commands

- `--version`/`-V`: prints CLI package version.
- `init [--force]`: initialize `.harness`; `--force` overwrites an existing workspace.
- `provider enable <provider>`: enable `codex`, `claude`, or `copilot`.
- `provider disable <provider>`: disable a provider.
- `registry list`: list configured registries.
- `registry add <name> --git-url <url> [--ref <ref>] [--root <path>] [--token-env <name>]`: add git registry.
- `registry remove <name>`: remove registry config (except built-in `local`).
- `registry default show|set <name>`: read/update default registry.
- `registry pull [<prompt|skill|mcp|subagent> <id>] [--registry <name>] [--force]`: refresh imported entities.
- `add prompt|skill|mcp|subagent [--registry <name>]`: scaffold source entities from default or explicit registry.
- `remove <prompt|skill|mcp|subagent> <id> [--no-delete-source]`: remove an entity from manifest and delete scaffolded source files by default (`prompt` requires id `system`).
- `validate`: print diagnostics and set exit code `1` if invalid.
- `plan [--json]`: show proposed file operations and diagnostics.
- `apply [--json]`: execute write/delete operations if no error diagnostics.
- `doctor [--json]`: report per-file schema version health and migration blockers.
- `migrate [--to latest] [--dry-run] [--json]`: upgrade workspace schemas with backup + atomic writes.
- `watch [--debounce <ms>]`: run apply loop on source changes.

## Behavior notes

- Global option: `--cwd <path>` sets workspace root.
- Default action (no subcommand) runs `plan` and prints operations and diagnostics.
- If `.harness` is missing, runtime commands report `WORKSPACE_NOT_INITIALIZED` with `harness init` guidance.
- All command failures are funneled through `program.parseAsync(...).catch(...)` and exit with code `1`.
- `doctor` exits `0` only when workspace is fully current; otherwise exits `1`.
- `migrate` exits `0` on success/no-op and `1` on blocked migrations (invalid/newer/unsupported).
