# Behavior Config

This guide explains how to parameterize harness entities with team-defined behavior levels, so the same canonical sources render different instructions per developer (for example an `effort` level that decides how much validation the agent runs per iteration).

## Motivation

Org-wide harnesses want one committed ruleset but per-developer behavior. Some developers want fast iteration (skip broad tests and linting until merge), others want every change fully validated. Behavior config solves this with two files:

| File | Purpose | Version control |
| --- | --- | --- |
| `.harness/behavior.map.yaml` | The ruleset: every allowed key, its allowed values, the instruction text each value expands to, and a required default | Committed |
| `.harness/behavior.yaml` | Each developer's chosen values (`effort: fast`) | Gitignored (recommended) |

Placeholders of the form `{{behavior.<key>}}` in entity sources are replaced at `harness plan`/`apply` time with the resolved instruction text: the developer's configured value when set, else the map's default. Keys are arbitrary identifiers; `effort` is just one example.

## Quick start

1. Author the committed map:

```yaml
# .harness/behavior.map.yaml
version: 1
keys:
  effort:
    description: How much validation to run per iteration
    default: thorough
    values:
      fast: |
        Skip broad tests, linting, and checks until the user requests a merge into main.
      thorough: |
        Run the full test and lint suite after every change.
```

2. Reference the key in a prompt-section source:

```markdown
<!-- .harness/src/prompt-sections/system/SECTION.md -->
## Effort policy

{{behavior.effort}}
```

3. Apply. With no local config the default (`thorough`) renders:

```bash
npx harness apply
```

4. A developer who wants fast iteration sets their local choice:

```bash
npx harness behavior set effort fast
npx harness apply
```

`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` now carry the `fast` instruction for that developer only.

### Recommended `.gitignore` entries

```gitignore
# Per-developer behavior choices
.harness/behavior.yaml
```

The map (`.harness/behavior.map.yaml`) is the shared contract and should always be committed.

## File shapes

### Behavior map (`.harness/behavior.map.yaml`)

- `version`: always `1` (the map is a versioned workspace document; `harness doctor` inspects it).
- `keys`: map of key name → entry. Key names must match `[a-zA-Z_][a-zA-Z0-9_]*` so every key is addressable as a placeholder.
- Each entry:
  - `description` (optional): what the key controls.
  - `default` (required): the value used when a developer has not set the key. Must be one of `values`.
  - `values` (required, non-empty): allowed value → instruction text. YAML block scalars (`|`) make multi-line prose natural.

### Behavior config (`.harness/behavior.yaml`)

A flat YAML map of key → chosen value:

```yaml
effort: fast
```

It is deliberately versionless: it is local, machine-written by `harness behavior set`, hand-editable, and trivially regenerable. Comments in a hand-edited config survive `harness behavior set`.

## Resolution rules

For every key defined in the map:

1. If the config sets the key to one of the entry's values, that value's instruction text is used (`source: config`).
2. Otherwise the entry's `default` instruction text is used (`source: default`).

Every `{{behavior.<key>}}` placeholder is then replaced with the resolved text at the raw-text level, before parsing, in all entity types (prompt-sections, skills, MCP configs, subagents, hooks, settings, commands) and override sidecars, exactly like [environment variable substitution](./environment-variables.md).

`npx harness behavior show` prints the resolved state per key (value, source, allowed values); `--json` returns it machine-readable.

## Placeholder syntax

```
{{behavior.<key>}}
```

- `<key>` must match `[a-zA-Z_][a-zA-Z0-9_]*`.
- The namespace is disjoint from env placeholders: `{{NAME}}` never matches a dotted key, and `{{behavior.x}}` never resolves from `.env` files or `process.env`.
- Nested expansion is unsupported: instruction text is inserted as-is in the behavior pass; whether other placeholders inside it are expanded is unspecified and must not be relied on.
- Instruction text substituted into JSON entity sources (MCP configs, hooks, JSON settings) must be JSON-string-safe; multi-line block-scalar values belong in markdown sources only (the same caveat env values have).

## Validation and diagnostics

| Code | Severity | Meaning |
| --- | --- | --- |
| `BEHAVIOR_MAP_MISSING` | error | `.harness/behavior.yaml` exists but `.harness/behavior.map.yaml` does not |
| `BEHAVIOR_MAP_INVALID` | error | Map YAML or schema is invalid (including a `default` not among `values`) |
| `BEHAVIOR_CONFIG_INVALID` | error | Config YAML or shape is invalid |
| `BEHAVIOR_KEY_UNKNOWN` | error | Config sets a key the map does not define |
| `BEHAVIOR_VALUE_INVALID` | error | Config sets a value the key does not allow |
| `BEHAVIOR_PLACEHOLDER_UNRESOLVED` | warning | `{{behavior.<key>}}` references a key the map does not define; the placeholder is left as-is |

Errors fail `harness validate` and block `harness apply`; the unresolved-placeholder warning does not (mirroring `ENV_VAR_UNRESOLVED`).

`harness behavior set` validates the key and value against the map before writing and refuses unknown keys or values with the allowed values named.

## Lock and drift semantics

Source SHA256 hashes in `manifest.lock.json` are computed on the raw pre-substitution text. Changing a behavior value never dirties the lock's `sourceSha256`; it changes the rendered artifacts, so `harness plan` shows normal `update` operations. This is the same design env var substitution uses.

## Watch mode

`npx harness watch` monitors `.harness/behavior.map.yaml` and `.harness/behavior.yaml` alongside entity sources and env files, re-applying automatically on changes.

## Doctor and versioning

The behavior map is a versioned workspace document of kind `behavior-map`. `harness doctor` inspects it when present (an absent map is simply skipped) and reports `BEHAVIOR_MAP_VERSION_*` statuses; a map written by a newer CLI blocks with `BEHAVIOR_MAP_VERSION_NEWER_THAN_CLI`. The config file is intentionally not versioned and not inspected by doctor.

## CLI reference

```bash
npx harness behavior set <key> <value>   # validate against the map, write .harness/behavior.yaml
npx harness behavior show                # print resolved values: key = value (source)  [allowed]
npx harness behavior show --json         # machine-readable resolved state
```

## Programmatic API

```typescript
import { loadBehavior, substituteBehaviorPlaceholders } from "@madebywild/agent-harness-framework";
```

- `loadBehavior(paths)`: loads and validates both files; returns `{ values, choices, diagnostics }` where `values` maps key → resolved instruction text and `choices` carries value/source/allowed per key.
- `substituteBehaviorPlaceholders(text, values)`: replaces `{{behavior.<key>}}` patterns; unresolved placeholders are left as-is and reported.
