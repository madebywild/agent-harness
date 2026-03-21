---
name: harness-subagent
description: Create and manage subagent entities in the agent-harness workspace. Invoke this skill when a user wants to define, scaffold, apply, or remove a subagent across Claude Code, OpenAI Codex, or GitHub Copilot.
---

# /harness-subagent

Use this skill to create and manage `subagent` entities in the agent-harness workspace. A subagent is a specialized agent definition — with a name, description, optional tool restrictions, and an optional model override — that harness renders into provider-native agent configuration files for every enabled provider.

---

## What is a subagent entity?

A subagent entity is a single canonical Markdown source file under `.harness/src/subagents/<subagent-id>.md`. It contains:

- **Required YAML frontmatter**: `name` and `description`
- **Optional frontmatter**: provider-specific fields set via override sidecars (model, tools, handoffs)
- **Body**: Markdown prose that becomes the agent's system prompt

Harness renders one output artifact per enabled provider from that single source file. You edit the source once; all provider files stay in sync.

---

## Provider output mapping

### Claude Code

| Item | Value |
|------|-------|
| Output path | `.claude/agents/<subagent-id>.md` |
| Format | Markdown with YAML frontmatter |
| Required frontmatter | `name`, `description` |
| Optional frontmatter | `tools` (string or `string[]`), `model` |

Claude Code loads agent files from `.claude/agents/` at session start. Each file's `description` field tells Claude when to delegate to that agent. Claude routes tasks automatically, or the user can invoke an agent explicitly with `@agent-<name>` or the `/agents` command. Supported `model` values: `sonnet`, `opus`, `haiku`, a full model ID such as `claude-sonnet-4-6`, or `inherit` (default). Subagents run in isolated context windows and cannot spawn further subagents.

Official docs: https://code.claude.com/docs/en/sub-agents

### OpenAI Codex CLI

| Item | Value |
|------|-------|
| Output path | `.codex/config.toml` |
| Format | TOML, section `[agents.<subagent-id>]` |
| Required fields | `description`, `prompt` (body) |
| Optional fields | `model`, `tools` (`string[]`) |
| Required top-level flag | `experimental_use_role = true` (auto-injected by harness) |

Harness writes all enabled subagents into `.codex/config.toml` under `[agents.<id>]` entries and sets `experimental_use_role = true` at the top level automatically — you do not need to set this manually. The `description` drives when Codex routes to that agent role; the body becomes `prompt`. Custom agents placed in `.codex/agents/` as standalone TOML files (outside of harness management) take precedence over same-named built-in agents.

Official docs: https://developers.openai.com/codex/subagents

### GitHub Copilot

| Item | Value |
|------|-------|
| Output path | `.github/agents/<subagent-id>.agent.md` |
| Format | Markdown with YAML frontmatter |
| Required frontmatter | `description` |
| Optional frontmatter | `name`, `tools` (`string[]`), `model`, `handoffs`, `mcp-servers`, `target`, `disable-model-invocation`, `user-invocable` |

Copilot discovers agent files in `.github/agents/` at the repository level. The `handoffs` field is Copilot-specific: it defines routing buttons that let users switch to another agent mid-conversation, optionally with a pre-filled prompt. Example handoff entry:

```yaml
handoffs:
  - label: "Start Implementation"
    agent: implementation
    prompt: "Now implement the plan outlined above."
    send: true
```

When `send: true` is set, the handoff prompt submits automatically.

Official docs: https://docs.github.com/en/copilot/reference/custom-agents-configuration

---

## Provider-specific frontmatter comparison

| Field | Claude Code | Codex CLI | GitHub Copilot |
|-------|-------------|-----------|----------------|
| `name` | required | via TOML key | optional |
| `description` | required | required | required |
| `tools` | `string` or `string[]` | `string[]` | `string[]` |
| `model` | optional | optional | optional |
| `handoffs` | — | — | optional |

Provider-specific options (`model`, `tools`, `handoffs`) are set through override sidecar files, not in the canonical source frontmatter — see the Override sidecars section below.

---

## Canonical source format

```markdown
---
name: <human-readable display name>
description: <when this agent should be used — used by all providers>
---

You are a [role description]. When invoked:

1. [Step one]
2. [Step two]
3. [Step three]

Focus on [specific domain]. Do not [out-of-scope actions].
```

Only `name` and `description` are required in the canonical frontmatter. The body becomes the agent's system prompt for all providers.

---

## Override sidecars

To set provider-specific options (model, tools, handoffs), create or edit the generated override YAML files:

- `.harness/src/subagents/<subagent-id>.overrides.claude.yaml`
- `.harness/src/subagents/<subagent-id>.overrides.codex.yaml`
- `.harness/src/subagents/<subagent-id>.overrides.copilot.yaml`

Example Claude override sidecar:

```yaml
version: 1
options:
  model: haiku
  tools:
    - Read
    - Grep
    - Glob
```

Example Copilot override sidecar:

```yaml
version: 1
options:
  model: gpt-4o
  tools:
    - search
    - fetch
  handoffs:
    - label: "Hand off to planner"
      agent: planner
      prompt: "Now create a plan based on the research above."
```

---

## Harness CLI commands

```bash
# Scaffold a new subagent source file and register it in manifest.json
npx harness add subagent <subagent-id>

# Preview what files will be generated (dry run)
npx harness plan

# Write all provider artifacts from current canonical sources
npx harness apply

# Watch sources and auto-apply on changes
npx harness watch

# Remove a subagent entity and its source files
npx harness remove subagent <subagent-id>

# Remove entity but keep source files on disk
npx harness remove subagent <subagent-id> --no-delete-source
```

---

## Complete example

Source file: `.harness/src/subagents/code-reviewer.md`

```markdown
---
name: code-reviewer
description: Expert code review specialist. Reviews code for quality, security, and maintainability. Use proactively after writing or modifying code.
---

You are a senior code reviewer ensuring high standards of quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately without asking for clarification

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated logic
- Proper error handling and input validation
- No exposed secrets or API keys
- Adequate test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix before merging)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix each issue. Do not modify files yourself.
```

Override sidecar for Claude (`.harness/src/subagents/code-reviewer.overrides.claude.yaml`):

```yaml
version: 1
options:
  model: sonnet
  tools:
    - Read
    - Grep
    - Glob
    - Bash
```

After running `npx harness apply`, this produces:

- `.claude/agents/code-reviewer.md` — used by Claude Code
- An entry in `.codex/config.toml` under `[agents.code-reviewer]` — used by Codex
- `.github/agents/code-reviewer.agent.md` — used by GitHub Copilot

---

## Typical workflow

```bash
# 1. Scaffold the subagent source
npx harness add subagent code-reviewer

# 2. Edit the source file
#    .harness/src/subagents/code-reviewer.md

# 3. (Optional) Edit provider-specific overrides
#    .harness/src/subagents/code-reviewer.overrides.claude.yaml

# 4. Preview the plan
npx harness plan

# 5. Generate provider artifacts
npx harness apply
```

Check `.claude/agents/`, `.codex/config.toml`, and `.github/agents/` to verify the rendered output.

---

## References

- Claude Code sub-agents: https://code.claude.com/docs/en/sub-agents
- OpenAI Codex subagents: https://developers.openai.com/codex/subagents
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- GitHub Copilot custom agents configuration: https://docs.github.com/en/copilot/reference/custom-agents-configuration
- GitHub Copilot custom agents how-to: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
- Agent harness providers overview: docs/providers.md
