# Monorepo support

The harness generates provider artifacts (`CLAUDE.md`, `.claude/skills/*`, `AGENTS.md`, …)
into the repository root by default. In a monorepo you often want those artifacts co-located
with the package they describe, so that Claude Code and Codex pick them up when you work in
that sub-tree. The optional per-entity `target` field does exactly that.

## The `target` field

Add `target` to any entity in `manifest.json`, or pass `--target <dir>` when scaffolding:

```bash
npx harness add skill api-testing --target packages/api
npx harness add prompt web --target packages/web   # id is optional; defaults to "system"
```

```json
{ "id": "api-testing", "type": "skill", "registry": "local",
  "sourcePath": ".harness/src/skills/api-testing/SKILL.md", "target": "packages/api" }
```

Rules:

- **Sources stay central.** `target` only relocates *generated* artifacts; the canonical
  source always lives under the root `.harness/src/`. There is one source of truth.
- **It is a directory prefix.** `packages/api` places the skill at
  `packages/api/.claude/skills/api-testing/`. A per-provider `targetPath` override composes
  *within* the target (`target` + `targetPath`), it does not replace it.
- **It is literal.** Unlike source content and override sidecars, the manifest is not
  environment-substituted, so `target` cannot contain `{{PLACEHOLDER}}`. Use a per-provider
  `targetPath` override for env-dynamic placement.
- **It cannot escape the repo root** (`..` and absolute paths are rejected).

To move an entity later, edit its `target` in `manifest.json` and run `npx harness apply`;
the stale artifact at the old location is pruned automatically.

## Multiple prompts

The single-`system`-prompt restriction is lifted. Define a root prompt plus one per package:

```bash
npx harness add prompt                                 # -> CLAUDE.md, AGENTS.md at root
npx harness add prompt web --target packages/web       # -> packages/web/CLAUDE.md, packages/web/AGENTS.md
```

Each prompt id maps to `.harness/src/prompts/<id>.md`.

## Capability-aware routing

Providers differ in what they discover when co-located. `target` is applied **only** for the
providers that actually nest a given artifact; for the rest the artifact stays at the root
(or, for a provider's single instructions file, a targeted prompt is skipped for that
provider). This is automatic: a single `target` does the right thing per provider.

| Artifact | Claude | Codex | Copilot | Cursor |
| --- | --- | --- | --- | --- |
| prompt (`CLAUDE.md` / `AGENTS.md`) | nests | nests | root only (one prompt fills it) | root only (one prompt fills it) |
| skill | nests | root | root | root |
| subagent / command | nests | n/a¹ / root | root | root |
| mcp / hook | nests² | root (`config.toml`) | root | root |

¹ Codex has no command artifact. ² Claude `.mcp.json` / `.claude/settings.json` are only read
when Claude starts in that directory.

So co-location pays off most for **Claude** (all artifacts) and **Codex prompts**. For a
root-only provider the harness emits a non-blocking diagnostic:

- `TARGET_ROUTED_TO_ROOT` (info) — a namespaced/aggregated artifact (or the prompt that owns a
  non-nesting provider's single root file) was placed at the root instead of the target.
- `TARGET_PROMPT_SKIPPED` (warning) — a targeted prompt was skipped for a provider because
  another prompt already claims that provider's single root instructions file. A non-nesting
  provider's root file is filled by the untargeted prompt if there is one, otherwise by the
  first targeted prompt — so co-locating your only prompt never leaves the provider empty.

## Aggregated artifacts

`.mcp.json`, `.claude/settings.json`, and codex `config.toml` merge multiple entities into one
file. They are grouped by resolved target: each distinct target directory gets its own merged
file, and entities that route to the root collapse into the single root file.

## Settings

The `settings` entity (a provider's raw config payload) is root-only in this version; setting
`target` on it is a `SETTINGS_TARGET_UNSUPPORTED` error. To co-locate hooks, target the `hook`
entities instead — they render into a per-package `.claude/settings.json`.

## Presets

Local and built-in presets honor `target` on their `add_*` operations (and an optional `id` on
`add_prompt`). Third-party presets resolved from a **registry** cannot know a consumer's
package layout, so their `target` is stripped and entities scaffold at the root; relocate them
afterward by editing `manifest.json`.

A preset may declare at most one `add_prompt` operation in this version — embedded preset
content carries a single prompt body, so multiple prompt operations are rejected
(`PRESET_UNSUPPORTED`) rather than scaffolding duplicate content.

Two prompts that resolve to the same directory (for example two untargeted prompts, both at
the root) are rejected at validation with `PROMPT_TARGET_CONFLICT`; give each prompt a distinct
`target`.
