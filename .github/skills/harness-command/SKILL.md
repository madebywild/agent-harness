---
name: harness-command
description: Help create and manage command entities in the agent-harness workspace. Use when the user wants to add a custom slash command, understands what command entities are, asks how commands differ from skills, or needs to know which providers support commands.
argument-hint: "[command-id]"
disable-model-invocation: true
---

# harness-command

You are helping the user create and manage `command` entities in an agent-harness workspace.

## What is a command entity?

A `command` entity defines a **custom slash command** — a reusable, invocable prompt that users trigger explicitly by typing `/command-name` in a supported AI coding tool. Commands are imperative one-shot actions: deploy a service, fix a GitHub issue, scaffold a component.

Source lives at: `.harness/src/commands/<command-id>.md`

## How commands differ from skills

| Aspect | `skill` | `command` |
|---|---|---|
| Source location | `.harness/src/skills/<id>/SKILL.md` (directory) | `.harness/src/commands/<id>.md` (single file) |
| Supporting files | Yes — additional files in the skill directory | No |
| Intended use | Reusable knowledge, conventions, recurring reference | Explicit one-shot actions with side effects |
| Auto-invocation by AI | Yes (model can load when relevant) | No — explicit invocation only |
| Provider support | Claude, Codex, Copilot | Claude, Copilot only (Codex: not supported) |

Use a **skill** for knowledge that Claude should apply automatically (API conventions, code style). Use a **command** for workflows you always trigger manually (`/deploy`, `/fix-issue`, `/release`).

## Source file format

`.harness/src/commands/<command-id>.md` is a Markdown file with YAML frontmatter:

```markdown
---
description: "Short description shown in the slash command picker"
argument-hint: "[issue-number]"
---

# command-id

Task instructions go here. Use $ARGUMENTS to receive arguments from the invocation.

Example: Fix GitHub issue $ARGUMENTS following the project's coding standards.

Steps:
1. Read the issue description
2. Implement the fix
3. Write tests
4. Create a commit
```

**Frontmatter fields:**

| Field | Required | Description |
|---|---|---|
| `description` | Yes | Non-empty string. Shown in the slash command picker. Validation fails if missing. |
| `argument-hint` | No | Hint shown at invocation (e.g. `[issue-number]` or `[filename] [format]`). Claude and Copilot only. |

**Body placeholders:**

- `$ARGUMENTS` — all text after the command name at invocation
- `$ARGUMENTS[N]` / `$N` — individual positional argument (Claude Code only)

## Provider output mapping

### Claude Code

- Output path: `.claude/commands/<command-id>.md`
- Invocation: `/<command-id>` in the Claude Code chat input
- Format: Markdown with YAML frontmatter

Generated frontmatter includes `description` and, if set, `argument-hint`. The body is written as-is.

Example output at `.claude/commands/fix-issue.md`:
```markdown
---
description: "Fix a GitHub issue"
argument-hint: "[issue-number]"
---

Fix GitHub issue $ARGUMENTS following the project's coding standards.
```

Claude Code also accepts `.claude/commands/` files directly (legacy commands); harness manages these files for you.

Reference: https://code.claude.com/docs/en/slash-commands

### GitHub Copilot

- Output path: `.github/prompts/<command-id>.prompt.md`
- Invocation: `/<command-id>` in Copilot Chat (VS Code, Visual Studio, JetBrains)
- Format: Markdown with YAML frontmatter; always includes `agent: agent`

Generated frontmatter always sets `agent: agent` (runs in agent mode). The `description` from your source is included. Body is written as-is.

Example output at `.github/prompts/fix-issue.prompt.md`:
```markdown
---
agent: agent
description: "Fix a GitHub issue"
---

Fix GitHub issue $ARGUMENTS following the project's coding standards.
```

Note: Copilot prompt files are supported in VS Code, Visual Studio, and JetBrains IDEs. As of early 2026, Copilot CLI does not support custom slash commands from `.github/prompts/`.

Reference: https://code.visualstudio.com/docs/copilot/customization/prompt-files

### OpenAI Codex CLI

**Not supported.** Codex has no `renderCommand` implementation. Codex deprecated its own custom prompts feature (`~/.codex/prompts/`) in favor of skills. Command entities are silently skipped when generating Codex artifacts.

If you need Codex-specific reusable prompts, use a `skill` entity instead.

## Provider support matrix

| Provider | Supported | Output path | Format |
|---|---|---|---|
| Claude Code | Yes | `.claude/commands/<id>.md` | Markdown + frontmatter |
| GitHub Copilot | Yes | `.github/prompts/<id>.prompt.md` | Markdown + frontmatter (`agent: agent`) |
| OpenAI Codex | No | — | — |

## Harness CLI commands

```bash
# Scaffold a new command entity and register it in manifest.json
npx harness add command <command-id>

# Preview what artifacts will be generated (dry run)
npx harness plan

# Write provider artifacts to disk
npx harness apply

# Remove a command entity and its source file
npx harness remove command <command-id>

# Remove but keep the source file
npx harness remove command <command-id> --no-delete-source
```

## Complete worked example

**1. Scaffold the entity:**
```bash
npx harness add command fix-issue
```

**2. Edit `.harness/src/commands/fix-issue.md`:**
```markdown
---
description: "Fix a GitHub issue by number"
argument-hint: "[issue-number]"
---

Fix GitHub issue $ARGUMENTS following the project's coding standards.

1. Read the issue description with `gh issue view $ARGUMENTS`
2. Understand the requirements
3. Implement the fix in the appropriate files
4. Write or update tests
5. Commit with a message referencing the issue
```

**3. Apply:**
```bash
npx harness apply
```

This writes:
- `.claude/commands/fix-issue.md` (if Claude provider is enabled)
- `.github/prompts/fix-issue.prompt.md` (if Copilot provider is enabled)

**4. Invoke in Claude Code:**
```
/fix-issue 1234
```

## Override sidecars

Per-provider overrides are supported via YAML sidecar files:

`.harness/src/commands/<id>.overrides.<provider>.yaml`

```yaml
version: 1
enabled: false        # disable this command for a specific provider
targetPath: "custom/path/command.md"   # override output path
```

## If the user provides a command-id as `$ARGUMENTS`

Scaffold the command now:

```bash
npx harness add command $ARGUMENTS
```

Then open `.harness/src/commands/$ARGUMENTS.md` and fill in:
1. A clear `description` in the frontmatter
2. An `argument-hint` if the command takes arguments
3. Step-by-step instructions in the body
4. `$ARGUMENTS` placeholder where input should be inserted

Run `npx harness apply` when done.
