# Toolkit Module Documentation

This set documents source files under `packages/toolkit/src`.

## Top-level modules

- `cli.ts`: [`toolkit.cli.md`](./toolkit.cli.md)
- `delegated-init.ts`: [`toolkit.delegated-init.md`](./toolkit.delegated-init.md)
- `engine.ts`: [`toolkit.engine.md`](./toolkit.engine.md)
- `env.ts`: [`toolkit.env.md`](./toolkit.env.md)
- `hooks.ts`: [`toolkit.hooks.md`](./toolkit.hooks.md)
- `index.ts`: [`toolkit.index.md`](./toolkit.index.md)
- `loader.ts`: [`toolkit.loader.md`](./toolkit.loader.md)
- `paths.ts`: [`toolkit.paths.md`](./toolkit.paths.md)
- `planner.ts`: [`toolkit.planner.md`](./toolkit.planner.md)
- `preset-builtin.ts`: [`toolkit.presets.md`](./toolkit.presets.md)
- `preset-packages.ts`: [`toolkit.presets.md`](./toolkit.presets.md)
- `presets.ts`: [`toolkit.presets.md`](./toolkit.presets.md)
- `providers.ts`: [`toolkit.providers.md`](./toolkit.providers.md)
- `repository.ts`: [`toolkit.repository.md`](./toolkit.repository.md)
- `types.ts`: [`toolkit.types.md`](./toolkit.types.md)
- `utils.ts`: [`toolkit.utils.md`](./toolkit.utils.md)

## CLI submodules

- `cli/main.ts`: mode-aware CLI bootstrap and execution entrypoints
- `cli/contracts.ts`: shared CLI contracts and envelope types
- `cli/command-registry.ts`: command metadata and dispatcher
- `cli/adapters/commander.ts`: non-interactive parser adapter
- `cli/adapters/interactive.ts`: prompt wizard adapter
- `cli/handlers/*.ts`: command-family execution handlers
- `cli/renderers/text.ts`: human-readable output renderer
- `cli/renderers/json.ts`: stable JSON envelope renderer
- `cli/utils/runtime.ts`: runtime environment and mode helpers

## Versioning modules

- `versioning/doctor.ts`: [`toolkit.versioning.doctor.md`](./toolkit.versioning.doctor.md)
- `versioning/migrate.ts`: [`toolkit.versioning.migrate.md`](./toolkit.versioning.migrate.md)
- `versioning/registry.ts`: [`toolkit.versioning.registry.md`](./toolkit.versioning.registry.md)

## Provider adapter modules

- `provider-adapters/claude.ts`: [`toolkit.provider.claude.md`](./toolkit.provider.claude.md)
- `provider-adapters/codex.ts`: [`toolkit.provider.codex.md`](./toolkit.provider.codex.md)
- `provider-adapters/constants.ts`: [`toolkit.provider.constants.md`](./toolkit.provider.constants.md)
- `provider-adapters/copilot.ts`: [`toolkit.provider.copilot.md`](./toolkit.provider.copilot.md)
- `provider-adapters/create-adapter.ts`: [`toolkit.provider.create-adapter.md`](./toolkit.provider.create-adapter.md)
- `provider-adapters/hooks.ts`: [`toolkit.provider.hooks.md`](./toolkit.provider.hooks.md)
- `provider-adapters/mcp.ts`: [`toolkit.provider.mcp.md`](./toolkit.provider.mcp.md)
- `provider-adapters/registry.ts`: [`toolkit.provider.registry.md`](./toolkit.provider.registry.md)
- `provider-adapters/renderers.ts`: [`toolkit.provider.renderers.md`](./toolkit.provider.renderers.md)
- `provider-adapters/subagents.ts`: [`toolkit.provider.subagents.md`](./toolkit.provider.subagents.md)
- `provider-adapters/types.ts`: [`toolkit.provider.types.md`](./toolkit.provider.types.md)
