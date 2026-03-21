# `packages/toolkit/src/delegated-init.ts`

## Purpose

Implements the delegated prompt authoring flow: after `harness init --delegate <provider>`, launches the selected provider's CLI so it can inspect the repository and replace the bootstrap prompt with a project-specific one.

## Key exports

- `DELEGATED_INIT_PRESET_ID` — `"delegate"`, the bundled preset used by the delegation flow.
- `buildDelegatedBootstrapPrompt()` — returns the markdown content seeded into `.harness/src/prompts/system.md` by the `delegate` preset. Instructs the agent to use harness CLI commands, not edit generated files directly.
- `buildDelegatedInitTask()` — returns the task prompt passed to the provider CLI. Instructs it to replace the bootstrap content, add any other entities, and run `harness plan` + `apply`.
- `launchDelegatedInit(input, spawnImpl?)` — spawns the provider CLI with `stdio: "inherit"` and returns a promise that resolves on exit code 0 or rejects on failure.

## Provider CLI invocation

Each provider CLI has a different non-interactive syntax:

| Provider | Binary | Args | Documentation |
| --- | --- | --- | --- |
| `claude` | `claude` | `-p <task>` | Print mode — processes prompt and exits. |
| `codex` | `codex` | `exec <task>` | Non-interactive exec subcommand. |
| `copilot` | `copilot` | `-p <task>` | Prompt mode — processes prompt and exits. |

These are encoded in `DELEGATED_INIT_COMMANDS` — a record mapping `ProviderId` to `{ binary, buildArgs(task) }`.

**Important**: Without these flags, `claude "task"` and `codex "task"` launch interactive TUI sessions (not non-interactive), and `copilot "task"` does not work at all (copilot requires `-p`).

## Guard rails

`handleInit` validates before launching:

- `--delegate` + `--json` → `INIT_DELEGATE_JSON_UNSUPPORTED` (provider CLI takes over the terminal).
- `--delegate` on non-TTY or CI → `INIT_DELEGATE_REQUIRES_TTY`.
- `--delegate` + `--preset` (other than `delegate`) → `INIT_DELEGATE_PRESET_CONFLICT`.

## Testing

`launchDelegatedInit` accepts an optional `spawnImpl` parameter for testing without launching real processes.
