# `packages/toolkit/src/env.ts`

## Purpose

Provides environment variable loading and placeholder substitution for harness entity source files. Enables secrets and context-dependent values to be injected at apply time without committing them to source.

See also: [Environment Variables Guide](./environment-variables.md)

## Exported APIs

- `parseEnvFile(content)`: parses a dotenv-format string into a `Map<string, string>`.
- `loadEnvVars(paths)`: loads and merges env vars from `.harness/.env` (high priority) and `.env.harness` (low priority).
- `substituteEnvVars(text, vars)`: replaces `{{PLACEHOLDER}}` patterns in text with values from the env var map, falling back to `process.env`.

## `parseEnvFile`

Parses standard dotenv syntax:

- Lines starting with `#` are comments.
- Empty lines are skipped.
- `KEY=value` format.
- Double-quoted values process `\n`, `\t`, `\\`, `\"` escape sequences.
- Single-quoted values are literal (no escape processing).
- Unquoted values are trimmed; inline comments after ` #` are stripped.
- `export` prefix: `export KEY=value` is supported (prefix is stripped).
- Duplicate keys: later definitions override earlier ones.
- Windows `\r\n` line endings are handled transparently.

Returns: `Map<string, string>`.

## `loadEnvVars`

Loads env files in priority order (lowest to highest):

1. `.env.harness` at project root (`paths.rootEnvFile`)
2. `.harness/.env` (`paths.envFile`)

Higher-priority entries override lower. Missing files are silently skipped.

Returns: `{ vars: Map<string, string>; diagnostics: Diagnostic[] }`.

## `substituteEnvVars`

Replaces all `{{KEY}}` patterns matching `/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`.

Resolution order per placeholder:

1. `vars` map (populated from `.env` files by `loadEnvVars`).
2. `process.env[key]` fallback (for CI/CD).

Unresolved placeholders are left as-is in the output text.

Returns:

- `result`: substituted text.
- `usedKeys`: `Set<string>` of keys that were successfully resolved.
- `unresolvedKeys`: `string[]` of placeholder names that could not be resolved from any source.

## Integration points

- Called by `loadCanonicalState` in `loader.ts` at the start of the loading pipeline.
- Env vars are passed to all five entity loaders (prompt, skill, mcp, subagent, hook) and to `readProviderOverrideFile` in `repository.ts`.
- Substitution occurs on raw file text **before** parsing (JSON, YAML, gray-matter).
- SHA256 hashes are always computed on the raw (pre-substitution) text.

## Diagnostics produced downstream

- `ENV_VAR_UNRESOLVED` (warning): a `{{PLACEHOLDER}}` could not be resolved from any source.
