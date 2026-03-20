import assert from "node:assert/strict";
import test from "node:test";
import { parseCanonicalHookDocument } from "../src/hooks.ts";
import {
  renderClaudeHookSettings,
  renderCopilotHookConfig,
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

test("resolveCodexNotifyCommand ignores unsupported events in best_effort mode", () => {
  const hooks: CanonicalHook[] = [
    {
      id: "guard",
      mode: "best_effort",
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

test("resolveCodexNotifyCommand throws for unsupported events in strict mode", () => {
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
      },
    },
  ];

  assert.throws(() => resolveCodexNotifyCommand(hooks), /HOOK_EVENT_UNSUPPORTED/u);
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
