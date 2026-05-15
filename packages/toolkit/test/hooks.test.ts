import assert from "node:assert/strict";
import test from "node:test";
import { parseCanonicalHookDocument } from "../src/hooks.ts";
import { nativeToCanonicalHookEvent } from "../src/provider-adapters/hook-capabilities.ts";
import {
  renderClaudeHookSettings,
  renderCodexHookConfigObject,
  renderCopilotHookConfig,
  renderCursorHookConfig,
  resolveCodexNotifyCommand,
  resolveHookTargetPath,
} from "../src/provider-adapters/hooks.ts";
import type { CanonicalHook, ProviderOverride } from "../src/types.ts";

test("parseCanonicalHookDocument defaults mode to strict", () => {
  const parsed = parseCanonicalHookDocument(
    {
      events: {
        turn_complete: [
          {
            type: "notify",
            command: ["python3", "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
    ".harness/src/hooks/guard.json",
    "guard",
  );

  assert.equal(parsed.diagnostics.length, 0);
  assert.equal(parsed.canonical?.mode, "strict");
  assert.equal(parsed.canonical?.events.turn_complete?.length, 1);
});

test("parseCanonicalHookDocument rejects mixed-type notify command arrays", () => {
  const parsed = parseCanonicalHookDocument(
    {
      mode: "strict",
      events: {
        turn_complete: [
          {
            type: "notify",
            command: ["python3", 123, "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
    ".harness/src/hooks/guard.json",
    "guard",
  );

  assert.equal(parsed.canonical, undefined);
  assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_NOTIFY_COMMAND_INVALID"));
});

test("parseCanonicalHookDocument rejects notify matcher usage", () => {
  const parsed = parseCanonicalHookDocument(
    {
      mode: "strict",
      events: {
        turn_complete: [
          {
            type: "notify",
            matcher: "Bash",
            command: ["python3", "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
    ".harness/src/hooks/guard.json",
    "guard",
  );

  assert.equal(parsed.canonical, undefined);
  assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_NOTIFY_MATCHER_UNSUPPORTED"));
});

test("parseCanonicalHookDocument rejects non-string env values", () => {
  const parsed = parseCanonicalHookDocument(
    {
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
            env: {
              FOO: "ok",
              BAR: 123,
            },
          },
        ],
      },
    },
    ".harness/src/hooks/guard.json",
    "guard",
  );

  assert.equal(parsed.canonical, undefined);
  assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_ENV_INVALID"));
});

test("parseCanonicalHookDocument validates optional statusMessage", () => {
  const parsed = parseCanonicalHookDocument(
    {
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
            statusMessage: "",
          },
        ],
      },
    },
    ".harness/src/hooks/guard.json",
    "guard",
  );

  assert.equal(parsed.canonical, undefined);
  assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === "HOOK_STATUS_MESSAGE_INVALID"));
});

test("resolveHookTargetPath returns explicit hook override target", () => {
  const overrideByEntity = new Map<string, ProviderOverride | undefined>([
    [
      "guard",
      {
        version: 1,
        targetPath: ".claude/custom-settings.json",
      },
    ],
  ]);

  const target = resolveHookTargetPath("claude", ".claude/settings.json", ["guard"], overrideByEntity);
  assert.equal(target, ".claude/custom-settings.json");
});

test("resolveHookTargetPath throws on conflicting hook target overrides", () => {
  const overrideByEntity = new Map<string, ProviderOverride | undefined>([
    ["guard-a", { version: 1, targetPath: ".claude/a.json" }],
    ["guard-b", { version: 1, targetPath: ".claude/b.json" }],
  ]);

  assert.throws(
    () => resolveHookTargetPath("claude", ".claude/settings.json", ["guard-a", "guard-b"], overrideByEntity),
    /HOOK_TARGET_CONFLICT/u,
  );
});

test("renderClaudeHookSettings skips unsupported events in best_effort mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "best_effort",
      events: {
        turn_complete: [
          {
            type: "notify",
            command: ["python3", "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
  ];

  const rendered = JSON.parse(renderClaudeHookSettings(hooks)) as { hooks: Record<string, unknown> };
  assert.deepEqual(rendered, { hooks: {} });
});

test("renderClaudeHookSettings throws for unsupported handler types in strict mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "notify",
            command: ["python3", "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
  ];

  assert.throws(() => renderClaudeHookSettings(hooks), /HOOK_EVENT_UNSUPPORTED/u);
});

test("renderCopilotHookConfig throws for matcher usage in strict mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            matcher: "Bash",
            command: "echo pre-tool",
          },
        ],
      },
    },
  ];

  assert.throws(() => renderCopilotHookConfig(hooks), /HOOK_EVENT_UNSUPPORTED/u);
});

test("renderCopilotHookConfig maps subagent_start and pre_compact", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        subagent_start: [
          {
            type: "command",
            command: "echo subagent-start",
          },
        ],
        pre_compact: [
          {
            type: "command",
            command: "echo pre-compact",
          },
        ],
      },
    },
  ];

  const rendered = JSON.parse(renderCopilotHookConfig(hooks)) as {
    version: number;
    hooks: Record<string, Array<Record<string, unknown>>>;
  };

  assert.equal(rendered.version, 1);
  assert.ok(rendered.hooks.subagentStart);
  assert.ok(rendered.hooks.preCompact);
});

test("renderCursorHookConfig maps canonical events and supports matcher/timeout", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
            matcher: "Bash",
            timeoutSec: 10,
          },
        ],
        prompt_submit: [
          {
            type: "command",
            command: "echo submit",
          },
        ],
      },
    },
  ];

  const rendered = JSON.parse(renderCursorHookConfig(hooks)) as {
    version: number;
    hooks: Record<string, Array<Record<string, unknown>>>;
  };

  assert.equal(rendered.version, 1);
  assert.ok(rendered.hooks.preToolUse);
  assert.ok(rendered.hooks.beforeSubmitPrompt);
  assert.equal(rendered.hooks.preToolUse?.[0]?.matcher, "Bash");
  assert.equal(rendered.hooks.preToolUse?.[0]?.timeout, 10);
});

test("renderCursorHookConfig enforces strict vs best_effort for unsupported capabilities", () => {
  const strictHooks: CanonicalHook[] = [
    {
      id: "strict",
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
            cwd: ".",
          },
        ],
      },
    },
  ];
  assert.throws(() => renderCursorHookConfig(strictHooks), /HOOK_EVENT_UNSUPPORTED/u);

  const bestEffortHooks: CanonicalHook[] = [
    {
      id: "best",
      mode: "best_effort",
      events: {
        pre_tool_use: [
          {
            type: "notify",
            command: ["python3", "notify.py"],
          },
        ],
      },
    },
  ];

  const rendered = JSON.parse(renderCursorHookConfig(bestEffortHooks)) as { hooks: Record<string, unknown> };
  assert.deepEqual(rendered.hooks, {});
});

test("resolveCodexNotifyCommand ignores unsupported events in best_effort mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
          },
        ],
        turn_complete: [
          {
            type: "notify",
            command: ["python3", "scripts/on_turn_complete.py"],
          },
        ],
      },
    },
  ];

  assert.deepEqual(resolveCodexNotifyCommand(hooks), ["python3", "scripts/on_turn_complete.py"]);
});

test("renderCodexHookConfigObject maps all supported lifecycle events and enables the canonical feature flag", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        session_start: [
          {
            type: "command",
            command: "echo session-start",
            matcher: "startup|resume",
          },
        ],
        prompt_submit: [
          {
            type: "command",
            command: "echo prompt",
          },
        ],
        pre_tool_use: [
          {
            type: "command",
            command: "echo pre-tool",
            matcher: "^Bash$",
            timeoutSec: 30,
            statusMessage: "Checking Bash command",
          },
        ],
        permission_request: [
          {
            type: "command",
            command: "echo permission-request",
            matcher: "^Bash$",
          },
        ],
        post_tool_use: [
          {
            type: "command",
            command: "echo post-tool",
            matcher: "^Bash$",
          },
        ],
        stop: [
          {
            type: "command",
            command: "echo stop",
          },
        ],
      },
    },
  ];

  const rendered = renderCodexHookConfigObject(hooks) as {
    features?: { hooks?: boolean; codex_hooks?: boolean };
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  };

  assert.equal(rendered.features?.hooks, true);
  assert.equal(rendered.features?.codex_hooks, undefined);
  assert.equal(rendered.hooks?.SessionStart?.[0]?.matcher, "startup|resume");
  assert.ok(rendered.hooks?.UserPromptSubmit);
  assert.equal(rendered.hooks?.PreToolUse?.[0]?.matcher, "^Bash$");
  assert.equal(rendered.hooks?.PreToolUse?.[0]?.hooks?.[0]?.timeout, 30);
  assert.equal(rendered.hooks?.PreToolUse?.[0]?.hooks?.[0]?.statusMessage, "Checking Bash command");
  assert.ok(rendered.hooks?.PermissionRequest);
  assert.ok(rendered.hooks?.PostToolUse);
  assert.ok(rendered.hooks?.Stop);
});

test("hook capabilities reverse-map native Codex and Claude events", () => {
  assert.equal(nativeToCanonicalHookEvent("codex", "PermissionRequest"), "permission_request");
  assert.equal(nativeToCanonicalHookEvent("codex", "SessionEnd"), undefined);
  assert.equal(nativeToCanonicalHookEvent("claude", "SessionEnd"), "session_end");
  assert.equal(nativeToCanonicalHookEvent("copilot", "preCompact"), "pre_compact");
});

test("non-Codex providers reject statusMessage in strict mode", () => {
  const hook: CanonicalHook = {
    id: "status",
    mode: "strict",
    events: {
      pre_tool_use: [
        {
          type: "command",
          command: "echo status",
          statusMessage: "Checking",
        },
      ],
    },
  };

  assert.throws(() => renderClaudeHookSettings([hook]), /HOOK_EVENT_UNSUPPORTED/u);
  assert.throws(() => renderCopilotHookConfig([hook]), /HOOK_EVENT_UNSUPPORTED/u);
  assert.throws(() => renderCursorHookConfig([hook]), /HOOK_EVENT_UNSUPPORTED/u);
});

test("renderCodexHookConfigObject throws for unsupported events in strict mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "strict",
      events: {
        session_end: [
          {
            type: "command",
            command: "echo nope",
          },
        ],
      },
    },
  ];

  assert.throws(() => renderCodexHookConfigObject(hooks), /HOOK_EVENT_UNSUPPORTED/u);
});

test("resolveCodexNotifyCommand rejects conflicting notify commands", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard-a",
      mode: "strict",
      events: {
        turn_complete: [
          {
            type: "notify",
            command: ["python3", "scripts/a.py"],
          },
        ],
      },
    },
    {
      id: "guard-b",
      mode: "strict",
      events: {
        turn_complete: [
          {
            type: "notify",
            command: ["python3", "scripts/b.py"],
          },
        ],
      },
    },
  ];

  assert.throws(() => resolveCodexNotifyCommand(hooks), /HOOK_NOTIFY_CONFLICT/u);
});

test("parseCanonicalHookDocument accepts new Claude-aligned events", () => {
  const parsed = parseCanonicalHookDocument(
    {
      mode: "strict",
      events: {
        setup: [{ type: "command", command: "echo setup" }],
        user_prompt_expansion: [{ type: "command", command: "echo expand" }],
        permission_denied: [{ type: "command", command: "echo denied" }],
        post_tool_batch: [{ type: "command", command: "echo batch" }],
        cwd_changed: [{ type: "command", command: "echo cwd" }],
        file_changed: [{ type: "command", command: "echo file" }],
        task_created: [{ type: "command", command: "echo task" }],
      },
    },
    ".harness/src/hooks/new-events.json",
    "new-events",
  );

  assert.equal(parsed.diagnostics.length, 0, JSON.stringify(parsed.diagnostics));
  assert.ok(parsed.canonical?.events.setup);
  assert.ok(parsed.canonical?.events.task_created);
});

test("renderClaudeHookSettings projects all new events to camelCase Claude names", () => {
  const hook: CanonicalHook = {
    id: "h",
    mode: "strict",
    events: {
      setup: [{ type: "command", command: "echo setup" }],
      user_prompt_expansion: [{ type: "command", command: "echo expand" }],
      permission_denied: [{ type: "command", command: "echo denied" }],
      post_tool_batch: [{ type: "command", command: "echo batch" }],
      cwd_changed: [{ type: "command", command: "echo cwd" }],
      file_changed: [{ type: "command", command: "echo file" }],
      task_created: [{ type: "command", command: "echo task" }],
    },
  };

  const json = JSON.parse(renderClaudeHookSettings([hook])) as { hooks: Record<string, unknown> };
  for (const eventName of [
    "Setup",
    "UserPromptExpansion",
    "PermissionDenied",
    "PostToolBatch",
    "CwdChanged",
    "FileChanged",
    "TaskCreated",
  ]) {
    assert.ok(json.hooks[eventName], `Claude hooks should expose ${eventName}: ${JSON.stringify(json)}`);
  }
});

test("non-Claude providers skip new events under best_effort", () => {
  const hook: CanonicalHook = {
    id: "h",
    mode: "best_effort",
    events: {
      setup: [{ type: "command", command: "echo setup" }],
      task_created: [{ type: "command", command: "echo task" }],
    },
  };

  const copilot = JSON.parse(renderCopilotHookConfig([hook])) as { hooks: Record<string, unknown> };
  const cursor = JSON.parse(renderCursorHookConfig([hook])) as { hooks: Record<string, unknown> };
  const codex = renderCodexHookConfigObject([hook]);

  assert.equal(Object.keys(copilot.hooks).length, 0);
  assert.equal(Object.keys(cursor.hooks).length, 0);
  assert.equal(codex, undefined);
});

test("non-Claude providers throw on new events under strict mode", () => {
  const hook: CanonicalHook = {
    id: "h",
    mode: "strict",
    events: {
      task_created: [{ type: "command", command: "echo task" }],
    },
  };

  assert.throws(() => renderCopilotHookConfig([hook]), /HOOK_EVENT_UNSUPPORTED/u);
  assert.throws(() => renderCursorHookConfig([hook]), /HOOK_EVENT_UNSUPPORTED/u);
  assert.throws(() => renderCodexHookConfigObject([hook]), /HOOK_EVENT_UNSUPPORTED/u);
});
