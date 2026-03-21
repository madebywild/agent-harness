---
name: harness-skill
description: Create and manage skill entities in the agent-harness workspace. Use when the user wants to add a new skill, understand how skills work across providers, or generate provider skill artifacts from a canonical source.
---

# harness-skill

You are helping the user create or manage a `skill` entity in the agent-harness workspace. Skills are reusable slash commands and procedural capabilities defined once in `.harness/src/` and rendered into every enabled provider's native format by `npx harness apply`.

Follow the steps and reference material below to complete the user's request.

---

## What is a skill entity?

A `skill` entity is the canonical source for a reusable, invocable capability. Define it once in `.harness/src/skills/<skill-id>/` and harness generates the matching artifacts for every enabled provider (Claude Code, OpenAI Codex, GitHub Copilot). This means one source of truth drives slash commands in all three tools.

---

## Source structure

```
.harness/src/skills/<skill-id>/
├── SKILL.md          # Main instructions (required)
├── reference.md      # Optional supplementary docs
├── examples/         # Optional example files
└── scripts/          # Optional scripts referenced in SKILL.md
```

`SKILL.md` is the only required file. Any additional files in the directory are copied alongside it into each provider's output directory.

---

## Workflow

```bash
# 1. Scaffold the skill source directory
npx harness add skill <skill-id>

# 2. Edit .harness/src/skills/<skill-id>/SKILL.md
#    (and any supporting files)

# 3. Generate provider artifacts
npx harness apply

# 4. To remove
npx harness remove skill <skill-id>
```

After `npx harness apply`, provider artifacts are written to the paths described below. Commit both `.harness/src/` and the generated provider files.

---

## Provider output mapping

### Claude Code

- **Output path:** `.claude/skills/<skill-id>/SKILL.md` (plus any supporting files)
- **Invocation:** `/<skill-id>` in a Claude Code session
- **Discovery:** Claude Code scans `.claude/skills/` in the project root and in every subdirectory up to the repo root (supports monorepos). Personal skills live at `~/.claude/skills/<skill-id>/`.
- **How it works:** The `SKILL.md` content becomes the prompt Claude receives when the skill is invoked. Claude also loads skill descriptions into context so it can invoke matching skills automatically unless `disable-model-invocation: true` is set.
- **Frontmatter fields supported:**

  | Field | Required | Notes |
  |---|---|---|
  | `name` | No | Defaults to directory name. Lowercase, hyphens only, max 64 chars. |
  | `description` | Recommended | Used by Claude to decide when to auto-invoke. |
  | `argument-hint` | No | Autocomplete hint, e.g. `[filename]`. |
  | `disable-model-invocation` | No | `true` = only user can invoke via `/skill-id`. |
  | `user-invocable` | No | `false` = hidden from `/` menu, Claude-only. |
  | `allowed-tools` | No | Tools permitted without per-use approval. |
  | `model` | No | Model override for this skill. |
  | `effort` | No | `low`, `medium`, `high`, or `max`. |
  | `context` | No | `fork` to run in an isolated subagent. |
  | `agent` | No | Subagent type when `context: fork` is set. |
  | `hooks` | No | Lifecycle hooks scoped to this skill. |

- **Argument substitution:** Use `$ARGUMENTS` for all passed args, `$ARGUMENTS[N]` or `$N` for positional args, `${CLAUDE_SKILL_DIR}` for the skill directory path, `${CLAUDE_SESSION_ID}` for the session ID.
- **Dynamic context:** `` !`<shell-command>` `` in the skill body runs the command before Claude sees the prompt; the output is injected inline.
- **Official docs:** https://code.claude.com/docs/en/slash-commands

### OpenAI Codex CLI

- **Output path:** `.codex/skills/<skill-id>/SKILL.md` (plus any supporting files)
- **Discovery:** Codex scans `.agents/skills/` from `$CWD` up to the repo root, and `~/.agents/skills/` for personal skills. Harness writes to `.codex/skills/` which maps to the project-level skills root.
- **Invocation:** Type `/skills` or `$` to mention a skill by name. Codex also selects skills implicitly based on the task description unless `allow_implicit_invocation: false` is set.
- **How it works:** Codex uses progressive disclosure — it loads only skill metadata initially and reads full instructions upon activation.
- **Frontmatter fields supported:** `name` and `description` are the primary fields. An optional `agents/openai.yaml` sidecar in the skill directory can set `policy.allow_implicit_invocation`, display metadata, and tool dependencies.
- **Official docs:** https://developers.openai.com/codex/skills

### GitHub Copilot

- **Output path:** `.github/skills/<skill-id>/SKILL.md` (plus any supporting files)
- **Discovery:** Copilot scans `.github/skills/` for project skills and `~/.copilot/skills/` for personal skills. Works in Copilot coding agent, Copilot CLI, and agent mode in VS Code.
- **Invocation:** Copilot automatically determines when to use a skill based on context. When activated, the full `SKILL.md` is injected into the agent's context.
- **How it works:** Skills supplement custom instructions (`.github/copilot-instructions.md`). Use custom instructions for broad coding standards; use skills for detailed, task-specific procedures Copilot should only load when relevant.
- **Frontmatter fields supported:**

  | Field | Required | Notes |
  |---|---|---|
  | `name` | Yes | Unique lowercase identifier matching the directory name. |
  | `description` | Yes | What the skill does and when Copilot should use it. |
  | `license` | No | Applicable licensing terms. |

- **Official docs:** https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills

---

## Provider-specific differences at a glance

| Aspect | Claude Code | Codex CLI | GitHub Copilot |
|---|---|---|---|
| Output root | `.claude/skills/` | `.codex/skills/` | `.github/skills/` |
| Invocation | `/<skill-id>` | `/skills` or `$mention` | Automatic on context match |
| Auto-invoke | Yes (opt-out via frontmatter) | Yes (opt-out via `openai.yaml`) | Yes (always context-driven) |
| Frontmatter richness | Extensive (9+ fields) | Minimal (`name`, `description`) | Minimal (`name`, `description`, `license`) |
| Argument passing | `$ARGUMENTS`, `$N` placeholders | Not specified | Not applicable |
| Subagent execution | `context: fork` | Not applicable | Not applicable |
| Supporting files | Fully supported | Supported (`scripts/`, `references/`) | Supported |

---

## SKILL.md format guide

A `SKILL.md` is a Markdown file with optional YAML frontmatter. Write it as an actionable prompt — describe what Claude (or the provider) should do when the skill is invoked.

**Structure:**

```markdown
---
name: my-skill
description: One sentence on what this skill does and when to use it.
disable-model-invocation: true   # optional: only if user-triggered only
argument-hint: "[target-file]"   # optional
---

# my-skill

Brief summary of the skill's purpose.

## Steps

1. First action
2. Second action
3. ...

## Notes

Any caveats or prerequisites.
```

**Content tips:**

- Write instructions in the imperative ("Read the file", "Run the tests", "Create a PR").
- Include the `$ARGUMENTS` placeholder where user input should appear.
- Keep `SKILL.md` under 500 lines; move large reference material to separate files in the directory and link them from `SKILL.md`.
- The `description` frontmatter field is the most important — it determines when providers auto-invoke the skill. Make it specific.

---

## Minimal working example

Directory layout:
```
.harness/src/skills/run-tests/
└── SKILL.md
```

`.harness/src/skills/run-tests/SKILL.md`:
```markdown
---
name: run-tests
description: Run the test suite for the current project and summarize failures. Use when the user asks to run tests, check test results, or debug a failing test.
---

Run the project test suite and report results.

1. Detect the test runner (check package.json scripts, Makefile, or pyproject.toml).
2. Run the tests: `$ARGUMENTS` (use this as extra flags if provided, otherwise omit).
3. Parse the output and list any failures with file name and line number.
4. Suggest a fix for the first failing test if the cause is clear.
```

After `npx harness apply` this produces:
- `.claude/skills/run-tests/SKILL.md` — invoked as `/run-tests` in Claude Code
- `.codex/skills/run-tests/SKILL.md` — available via `$run-tests` in Codex
- `.github/skills/run-tests/SKILL.md` — auto-loaded by Copilot when tests are relevant

---

## Harness CLI reference

```bash
npx harness add skill <skill-id>          # scaffold .harness/src/skills/<skill-id>/SKILL.md
npx harness apply                          # generate provider skill artifacts for all enabled providers
npx harness plan                           # dry run: show what apply would write
npx harness remove skill <skill-id>        # remove skill entity and source files
npx harness remove skill <skill-id> --no-delete-source  # remove from manifest but keep source
npx harness provider enable claude         # ensure the claude provider is enabled
npx harness provider enable codex          # ensure the codex provider is enabled
npx harness provider enable copilot        # ensure the copilot provider is enabled
```

---

## Official documentation

- Claude Code skills / slash commands: https://code.claude.com/docs/en/slash-commands
- OpenAI Codex agent skills: https://developers.openai.com/codex/skills
- GitHub Copilot agent skills: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills
- GitHub Copilot skills (VS Code): https://code.visualstudio.com/docs/copilot/customization/agent-skills
- Agent Skills open standard: https://agentskills.io
