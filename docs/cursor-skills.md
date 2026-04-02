# Agent Skills

Agent Skills is an open standard for extending AI agents with specialized capabilities. Skills package domain-specific knowledge and workflows that agents can use to perform specific tasks.

## What are skills?

A skill is a portable, version-controlled package that teaches agents how to perform domain-specific tasks. Skills can include scripts, templates, and references that agents may act on using their tools.

- [Portable](): Skills work across any agent that supports the Agent Skills standard.
- [Version-controlled](): Skills are stored as files and can be tracked in your repository, or installed via GitHub repository links.
- [Actionable](): Skills can include scripts, templates, and references that agents act on using their tools.
- [Progressive](): Skills load resources on demand, keeping context usage efficient.

## How skills work

When Cursor starts, it automatically discovers skills from skill directories and makes them available to Agent. The agent is presented with available skills and decides when they are relevant based on context.

Skills can also be manually invoked by typing `/` in Agent chat and searching for the skill name.

## Skill directories

Skills are automatically loaded from these locations:

LocationScope`.agents/skills/`Project-level`.cursor/skills/`Project-level`~/.cursor/skills/`User-level (global)
For compatibility, Cursor also loads skills from Claude and Codex directories: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, and `~/.codex/skills/`.

Each skill should be a folder containing a `SKILL.md` file:

```
.agents/
└── skills/
    └── my-skill/
        └── SKILL.md
```

Skills can also include optional directories for scripts, references, and assets:

```
.agents/
└── skills/
    └── deploy-app/
        ├── SKILL.md
        ├── scripts/
        │   ├── deploy.sh
        │   └── validate.py
        ├── references/
        │   └── REFERENCE.md
        └── assets/
            └── config-template.json
```

## SKILL.md file format

Each skill is defined in a `SKILL.md` file with YAML frontmatter:

```
---
name: my-skill
description: Short description of what this skill does and when to use it.
---

# My Skill

Detailed instructions for the agent.

## When to Use

- Use this skill when...
- This skill is helpful for...

## Instructions

- Step-by-step guidance for the agent
- Domain-specific conventions
- Best practices and patterns
- Use the ask questions tool if you need to clarify requirements with the user
```

### Frontmatter fields

FieldRequiredDescription`name`YesSkill identifier. Lowercase letters, numbers, and hyphens only. Must match the parent folder name.`description`YesDescribes what the skill does and when to use it. Used by the agent to determine relevance.`license`NoLicense name or reference to a bundled license file.`compatibility`NoEnvironment requirements (system packages, network access, etc.).`metadata`NoArbitrary key-value mapping for additional metadata.`disable-model-invocation`NoWhen `true`, the skill is only included when explicitly invoked via `/skill-name`. The agent will not automatically apply it based on context.

## Disabling automatic invocation

By default, skills are automatically applied when the agent determines they are relevant. Set `disable-model-invocation: true` to make a skill behave like a traditional slash command, where it is only included in context when you explicitly type `/skill-name` in chat.

## Including scripts in skills

Skills can include a `scripts/` directory containing executable code that agents can run. Reference scripts in your `SKILL.md` using relative paths from the skill root.

```
---
name: deploy-app
description: Deploy the application to staging or production environments. Use when deploying code or when the user mentions deployment, releases, or environments.
---

# Deploy App

Deploy the application using the provided scripts.

## Usage

Run the deployment script: `scripts/deploy.sh <environment>`

Where `<environment>` is either `staging` or `production`.

## Pre-deployment Validation

Before deploying, run the validation script: `python scripts/validate.py`
```

The agent reads these instructions and executes the referenced scripts when the skill is invoked. Scripts can be written in any language—Bash, Python, JavaScript, or any other executable format supported by the agent implementation.

Scripts should be self-contained, include helpful error messages, and handle edge cases gracefully.

## Optional directories

Skills support these optional directories:

DirectoryPurpose`scripts/`Executable code that agents can run`references/`Additional documentation loaded on demand`assets/`Static resources like templates, images, or data files
Keep your main `SKILL.md` focused and move detailed reference material to separate files. This keeps context usage efficient since agents load resources progressively—only when needed.

## Viewing skills

To view discovered skills:

1. Open **Cursor Settings** (Cmd+Shift+J on Mac, Ctrl+Shift+J on Windows/Linux)
2. Navigate to **Rules**
3. Skills appear in the **Agent Decides** section

## Installing skills from GitHub

You can import skills from GitHub repositories:

1. Open **Cursor Settings → Rules**
2. In the **Project Rules** section, click **Add Rule**
3. Select **Remote Rule (Github)**
4. Enter the GitHub repository URL

## Migrating rules and commands to skills

Cursor includes a built-in `/migrate-to-skills` skill in 2.4 that helps you convert existing dynamic rules and slash commands to skills.

The migration skill converts:

- **Dynamic rules**: Rules that use the "Apply Intelligently" configuration—rules with `alwaysApply: false` (or undefined) and no `globs` patterns defined. These are converted to standard skills.
- **Slash commands**: Both user-level and workspace-level commands are converted to skills with `disable-model-invocation: true`, preserving their explicit invocation behavior.

To migrate:

1. Type `/migrate-to-skills` in Agent chat
2. The agent will identify eligible rules and commands and convert them to skills
3. Review the generated skills in `.cursor/skills/`

Rules with `alwaysApply: true` or specific `globs` patterns are not migrated, as they have explicit triggering conditions that differ from skill behavior. User rules are also not migrated since they are not stored on the file system.

## Learn more

Agent Skills is an open standard. Learn more at [agentskills.io](https://agentskills.io).
