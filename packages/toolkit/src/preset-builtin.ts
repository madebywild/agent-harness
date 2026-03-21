import { buildDelegatedBootstrapPrompt, DELEGATED_INIT_PRESET_ID } from "./delegated-init.js";
import type { ResolvedPreset } from "./types.js";

export const BUILTIN_PRESETS: readonly ResolvedPreset[] = [
  {
    source: "builtin",
    definition: {
      id: DELEGATED_INIT_PRESET_ID,
      name: "Delegated Prompt Init",
      description:
        "Seed one shared bootstrap prompt for all providers before handing prompt authoring to a chosen agent CLI.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "enable_provider", provider: "copilot" },
        { type: "add_prompt" },
      ],
    },
    content: {
      prompt: buildDelegatedBootstrapPrompt(),
    },
  },
  {
    source: "builtin",
    definition: {
      id: "starter",
      name: "Starter Workspace",
      description: "A fast starting point with a shared system prompt, a review skill, and a fix-issue command.",
      recommended: true,
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "enable_provider", provider: "copilot" },
        { type: "add_prompt" },
        { type: "add_skill", id: "reviewer" },
        { type: "add_command", id: "fix-issue" },
      ],
    },
    content: {
      prompt:
        "# System Prompt\n\nBe precise, implementation-focused, and explicit about trade-offs. Prefer inspecting the repository before proposing changes, keep edits minimal, and explain any blockers directly.\n",
      skills: {
        reviewer: [
          {
            path: "SKILL.md",
            content:
              "---\nname: reviewer\ndescription: Review implementation plans and patches for correctness, regressions, and missing tests.\n---\n\n# reviewer\n\nUse this skill when you want a rigorous code review mindset. Prioritize concrete bugs, behavioral regressions, weak assumptions, and missing coverage before giving summaries.\n",
          },
        ],
      },
      commands: {
        "fix-issue":
          '---\ndescription: "Investigate a bug report, locate the root cause, and implement the smallest defensible fix"\n---\n\n# fix-issue\n\nAnalyze the reported issue, confirm the failing behavior, inspect the relevant code path, and implement the narrowest fix that resolves the root cause. Add or update tests when the failure mode is testable.\n',
      },
    },
  },
  {
    source: "builtin",
    definition: {
      id: "researcher",
      name: "Research Assistant",
      description: "A preset for repositories that need synthesis-heavy work with a dedicated research subagent.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "enable_provider", provider: "copilot" },
        { type: "add_prompt" },
        { type: "add_subagent", id: "research-assistant" },
      ],
    },
    content: {
      prompt:
        "# System Prompt\n\nPrefer evidence-driven analysis. Separate facts from assumptions, cite the files and commands you used, and keep recommendations actionable.\n",
      subagents: {
        "research-assistant":
          "---\nname: Research Assistant\ndescription: Gather relevant context, compare alternatives, and return a concise evidence-backed summary.\n---\n\nYou are a research-focused subagent. Collect the minimum set of repository context needed to answer the question, identify trade-offs, and summarize concrete findings with supporting references.\n",
      },
    },
  },
  {
    source: "builtin",
    definition: {
      id: "yolo",
      name: "YOLO Mode",
      description:
        "Maximum autonomy — all providers enabled with full permissions, no approval prompts, and no sandboxing.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "enable_provider", provider: "copilot" },
        { type: "add_prompt" },
        { type: "add_settings", provider: "claude" },
        { type: "add_settings", provider: "codex" },
        { type: "add_settings", provider: "copilot" },
      ],
    },
    content: {
      prompt:
        "# System Prompt\n\nYou have full autonomy. Proceed without asking for confirmation — read, write, execute, and search freely. Prefer action over discussion.\n",
      settings: {
        claude: {
          permissions: {
            allow: ["Bash", "Read", "Edit", "Write", "WebFetch", "WebSearch", "Agent", "mcp__*"],
            defaultMode: "bypassPermissions",
          },
        },
        codex: {
          approval_policy: "never",
          sandbox_mode: "danger-full-access",
        },
        copilot: {
          "chat.tools.global.autoApprove": true,
          "chat.autopilot.enabled": true,
        },
      },
    },
  },
];
