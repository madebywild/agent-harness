# Environment Variables

This guide explains how to use environment variables to parameterize harness entities and safely inject secrets into generated provider artifacts.

## Motivation

Entity source files (prompts, skills, MCP configs, subagents, hooks) are committed to the repository. This creates two problems:

1. **Secrets** (API keys, tokens, credentials) must not be committed.
2. **Context-dependent values** (project names, environment labels, URLs) differ across environments.

Environment variable placeholders solve both: source files contain `{{PLACEHOLDER}}` markers, and values are resolved at `harness apply` time from `.env` files or the process environment.

## Quick start

1. Initialize and add an entity:

```bash
harness init
harness add mcp my-server
harness provider enable claude
```

2. Reference a secret in the entity source:

```json
{
  "servers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "{{API_KEY}}" }
    }
  }
}
```

3. Create `.harness/.env` with the secret value:

```
API_KEY=sk-secret-12345
```

4. Apply:

```bash
harness apply
```

The generated `.mcp.json` will contain the resolved value `sk-secret-12345`, not the raw placeholder.

## Env file locations

Harness loads env vars from two file locations, merged in priority order:

| Priority | File | Typical use | Version control |
| --- | --- | --- | --- |
| 1 (highest) | `.harness/.env` | Secrets, local overrides | Gitignored |
| 2 | `.env.harness` (project root) | Shared, non-secret params | Optionally committed |

Higher-priority files override lower-priority ones for the same key. Both files are optional; missing files are silently skipped.

A third fallback layer is `process.env`. If a placeholder key is not found in either file, the current process environment is checked. This enables CI/CD pipelines to inject values without any `.env` file.

### Recommended `.gitignore` entries

```gitignore
# Harness secrets
.harness/.env
```

`.env.harness` can be committed when it contains only non-secret configuration (project names, environment labels, feature flags).

## Env file format

Both files use standard dotenv syntax:

```bash
# Comments start with #
PROJECT_NAME=my-app
ENVIRONMENT=production

# Double-quoted values support escape sequences
GREETING="Hello\nWorld"

# Single-quoted values are literal (no escapes)
REGEX_PATTERN='foo\nbar'

# Empty values
EMPTY_VAR=

# Values with = signs
DATABASE_URL=postgres://user:pass@localhost:5432/db?ssl=true

# Inline comments (space + #)
TIMEOUT=30 # seconds
```

### Supported features

- **Comments**: Lines starting with `#` are ignored.
- **Empty lines**: Skipped.
- **Double-quoted values**: Support `\n`, `\t`, `\\`, `\"` escape sequences.
- **Single-quoted values**: Literal content, no escape processing.
- **Unquoted values**: Trimmed; inline comments after ` #` are stripped.
- **Duplicate keys**: Later definitions override earlier ones within the same file.
- **Windows line endings**: `\r\n` is handled transparently.

## Placeholder syntax

Placeholders use double-brace syntax:

```
{{VARIABLE_NAME}}
```

**Rules:**

- Variable names must start with a letter or underscore, followed by letters, digits, or underscores.
- Valid: `{{API_KEY}}`, `{{my_var}}`, `{{_PRIVATE}}`, `{{DB_HOST_2}}`
- Invalid (not matched): `{{123}}`, `{{a-b}}`, `{{}}`
- Single braces `{VAR}` are **not** matched.
- Placeholders are replaced in-place within the source text before any parsing occurs.

## Resolution order

When a `{{KEY}}` placeholder is encountered, harness resolves it in this order:

1. `.harness/.env`
2. `.env.harness`
3. `process.env`

The first match wins. If no match is found in any source, the placeholder is left as-is and a diagnostic warning is emitted.

## Supported entity types

Env var substitution works across **all** entity types and override sidecars:

| Entity type | Source file | Substitution applies to |
| --- | --- | --- |
| Prompt | `.harness/src/prompts/system.md` | Full file (frontmatter + body) |
| Skill | `.harness/src/skills/<id>/SKILL.md` (+ other files) | All files in skill directory |
| MCP config | `.harness/src/mcp/<id>.json` | Full JSON text |
| Subagent | `.harness/src/subagents/<id>.md` | Full file (frontmatter + body) |
| Hook | `.harness/src/hooks/<id>.json` | Full JSON text |
| Override sidecar | `.harness/src/**/*.overrides.<provider>.yaml` | Full YAML text |

Substitution happens at the **text level**, before the file is parsed as JSON, YAML, or markdown. This means placeholders work inside JSON string values, YAML values, markdown content, and frontmatter fields.

## Examples

### Prompt with context parameters

Source (`.harness/src/prompts/system.md`):

```markdown
You are a {{ROLE}} assistant for the {{PROJECT_NAME}} project.
You are operating in the {{ENVIRONMENT}} environment.
```

`.env.harness` (committed, shared defaults):

```
PROJECT_NAME=acme-platform
ENVIRONMENT=development
ROLE=general-purpose
```

`.harness/.env` (local override):

```
ENVIRONMENT=staging
```

Result: `ENVIRONMENT` resolves to `staging` (from `.harness/.env`), while `PROJECT_NAME` and `ROLE` come from `.env.harness`.

### MCP config with secrets

Source (`.harness/src/mcp/database.json`):

```json
{
  "servers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "{{DATABASE_URL}}"]
    }
  }
}
```

`.harness/.env`:

```
DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/prod
```

### Subagent with parameterized identity

Source (`.harness/src/subagents/reviewer.md`):

```markdown
---
name: {{TEAM_NAME}} Reviewer
description: Code reviewer for the {{TEAM_NAME}} team
---

You are the code reviewer for the {{TEAM_NAME}} team.
Follow the {{TEAM_NAME}} style guide at {{STYLE_GUIDE_URL}}.
```

### Hook with environment-specific scripts

Source (`.harness/src/hooks/guard.json`):

```json
{
  "mode": "strict",
  "events": {
    "pre_tool_use": [
      {
        "type": "command",
        "command": "{{GUARD_COMMAND}}",
        "timeoutSec": {{GUARD_TIMEOUT}}
      }
    ]
  }
}
```

`.harness/.env`:

```
GUARD_COMMAND=python3 scripts/security_check.py
GUARD_TIMEOUT=15
```

Note: `{{GUARD_TIMEOUT}}` is replaced in the raw JSON text before parsing, so the resulting JSON contains the numeric literal `15`.

### Override YAML with dynamic target path

Override (`.harness/src/prompts/system.overrides.codex.yaml`):

```yaml
version: 1
targetPath: "{{CODEX_PROMPT_PATH}}"
```

`.env.harness`:

```
CODEX_PROMPT_PATH=custom/AGENTS.md
```

### Skill files with versioned tooling

Source (`.harness/src/skills/linter/SKILL.md`):

```markdown
# Linter v{{TOOL_VERSION}}

Use ESLint v{{TOOL_VERSION}} to lint all TypeScript files.
Run: `npx eslint@{{TOOL_VERSION}} .`
```

## SHA fingerprinting and lock stability

Source file SHA256 hashes in `manifest.lock.json` are computed on the **raw** (pre-substitution) text. This means:

- Changing a value in `.harness/.env` does **not** change the lock file's `sourceSha256` for any entity.
- The lock tracks whether the source **template** changed, not the resolved output.
- However, changing an env var value does cause the rendered output to differ, which triggers an `update` operation during `harness apply`.

This design keeps the lock stable and diff-friendly in version control while still ensuring outputs stay up to date.

## Watch mode

`harness watch` monitors env files for changes alongside entity sources:

- `.harness/.env`
- `.env.harness` (project root)

When either file changes, harness re-runs apply automatically.

## Diagnostics

### `ENV_VAR_UNRESOLVED` (warning)

Emitted when a `{{PLACEHOLDER}}` in a source or override file cannot be resolved from any source (`.harness/.env`, `.env.harness`, or `process.env`).

```
warning: Unresolved env placeholder '{{MISSING_KEY}}' in '.harness/src/prompts/system.md'
```

The unresolved placeholder is left as-is in the output. This is a warning, not an error, so `harness apply` still proceeds.

### `ENV_FILE_PARSE_ERROR` (warning)

Emitted when an env file exists but cannot be parsed. The file is skipped and other sources are still used.

## CI/CD integration

In CI/CD pipelines, you typically do not have `.env` files. Instead, inject values through the process environment:

```yaml
# GitHub Actions example
- name: Apply harness
  run: harness apply
  env:
    API_KEY: ${{ secrets.API_KEY }}
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    ENVIRONMENT: production
```

The `process.env` fallback ensures these values resolve without any `.env` file present.

## Programmatic API

The env module is exported from the toolkit package for programmatic use:

```typescript
import { parseEnvFile, loadEnvVars, substituteEnvVars } from "@madebywild/agent-harness-framework";
```

### `parseEnvFile(content: string): Map<string, string>`

Parses a dotenv-format string into key-value pairs.

### `loadEnvVars(paths: HarnessPaths): Promise<{ vars: Map<string, string>; diagnostics: Diagnostic[] }>`

Loads and merges env vars from `.harness/.env` and `.env.harness`. Returns the merged map plus any parse-error diagnostics.

### `substituteEnvVars(text: string, vars: Map<string, string>): { result: string; usedKeys: Set<string>; unresolvedKeys: string[] }`

Replaces `{{PLACEHOLDER}}` patterns in text. Falls back to `process.env` for keys not in `vars`. Returns the substituted text, the set of keys that were used, and the list of keys that could not be resolved.

## Security considerations

- **Never commit `.harness/.env`**. Add it to `.gitignore`.
- Resolved secret values appear in generated output files (for example `.mcp.json`). Ensure those outputs are also gitignored if they contain secrets, or use provider-level mechanisms (like environment variable references) instead of literal injection where possible.
- The lock file does not contain resolved values; it only stores SHA256 hashes of the raw source templates.
- `process.env` fallback means any environment variable on the machine is accessible via `{{NAME}}` if not shadowed by a `.env` file entry. This is by design for CI/CD but worth noting for shared machines.

## Best practices

1. **Use `.env.harness` for shared defaults** and `.harness/.env` for secrets and local overrides.
2. **Document expected variables** in your project README or a `.env.harness.example` file.
3. **Use `process.env` fallback** in CI/CD rather than generating `.env` files.
4. **Check diagnostics** after `harness apply` for `ENV_VAR_UNRESOLVED` warnings to catch typos.
5. **Keep placeholder names descriptive**: `{{DATABASE_URL}}` is better than `{{DB}}`.
