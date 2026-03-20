import { stableHookCommandArray } from "../hooks.js";
import type {
  CanonicalHook,
  CanonicalHookCommandHandler,
  CanonicalHookEvent,
  CanonicalHookHandler,
  ProviderOverride,
} from "../types.js";
import { normalizeRelativePath, stableStringify } from "../utils.js";

const CLAUDE_EVENT_MAP: Partial<Record<CanonicalHookEvent, string>> = {
  session_start: "SessionStart",
  session_end: "SessionEnd",
  prompt_submit: "UserPromptSubmit",
  pre_tool_use: "PreToolUse",
  permission_request: "PermissionRequest",
  post_tool_use: "PostToolUse",
  post_tool_failure: "PostToolUseFailure",
  notification: "Notification",
  subagent_start: "SubagentStart",
  subagent_stop: "SubagentStop",
  stop: "Stop",
  stop_failure: "StopFailure",
  teammate_idle: "TeammateIdle",
  task_completed: "TaskCompleted",
  instructions_loaded: "InstructionsLoaded",
  config_change: "ConfigChange",
  worktree_create: "WorktreeCreate",
  worktree_remove: "WorktreeRemove",
  pre_compact: "PreCompact",
  post_compact: "PostCompact",
  elicitation: "Elicitation",
  elicitation_result: "ElicitationResult",
};

const COPILOT_EVENT_MAP: Partial<Record<CanonicalHookEvent, string>> = {
  session_start: "sessionStart",
  session_end: "sessionEnd",
  prompt_submit: "userPromptSubmitted",
  pre_tool_use: "preToolUse",
  post_tool_use: "postToolUse",
  stop: "agentStop",
  subagent_stop: "subagentStop",
  error: "errorOccurred",
};

const CLAUDE_MATCHER_SUPPORTED_EVENTS = new Set<CanonicalHookEvent>([
  "pre_tool_use",
  "post_tool_use",
  "post_tool_failure",
  "permission_request",
  "session_start",
  "session_end",
  "notification",
  "subagent_start",
  "subagent_stop",
  "config_change",
  "stop_failure",
  "instructions_loaded",
  "pre_compact",
  "post_compact",
  "elicitation",
  "elicitation_result",
]);

export function resolveHookTargetPath(
  provider: "codex" | "claude" | "copilot",
  defaultTargetPath: string,
  hookIds: ReadonlyArray<string>,
  overrideByEntity?: ReadonlyMap<string, ProviderOverride | undefined>,
): string {
  const targets = new Set<string>();

  for (const hookId of hookIds) {
    const override = overrideByEntity?.get(hookId);
    if (override?.targetPath) {
      targets.add(normalizeRelativePath(override.targetPath));
    }
  }

  if (targets.size > 1) {
    throw new Error(
      `HOOK_TARGET_CONFLICT: conflicting hook targetPath overrides for provider '${provider}': ${[...targets].join(", ")}`,
    );
  }

  if (targets.size === 1) {
    return [...targets][0] as string;
  }

  return normalizeRelativePath(defaultTargetPath);
}

export function renderClaudeHookSettings(hooks: ReadonlyArray<CanonicalHook>): string {
  const events: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> = {};

  for (const hook of hooks) {
    for (const [eventName, handlers] of Object.entries(hook.events) as Array<
      [CanonicalHookEvent, CanonicalHook["events"][CanonicalHookEvent]]
    >) {
      const mappedEvent = CLAUDE_EVENT_MAP[eventName];
      if (!mappedEvent) {
        handleUnsupported(hook, "claude", `event '${eventName}'`);
        continue;
      }

      if (!handlers || handlers.length === 0) {
        continue;
      }

      const groups = new Map<string, Array<Record<string, unknown>>>();
      const matcherSupported = CLAUDE_MATCHER_SUPPORTED_EVENTS.has(eventName);

      for (const handler of handlers) {
        if (handler.type !== "command") {
          handleUnsupported(hook, "claude", `handler type '${handler.type}'`);
          continue;
        }

        if (handler.matcher && !matcherSupported) {
          handleUnsupported(hook, "claude", `matcher on event '${eventName}'`);
          continue;
        }

        const rendered = renderClaudeCommand(handler);
        if (!rendered) {
          handleUnsupported(hook, "claude", "command fields");
          continue;
        }

        const groupKey = matcherSupported ? handler.matcher?.trim() || "__all__" : "__all__";
        const entry = groups.get(groupKey) ?? [];
        entry.push(rendered);
        groups.set(groupKey, entry);
      }

      if (groups.size === 0) {
        continue;
      }

      const groupEntries = [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([matcher, groupedHooks]) =>
          matcher === "__all__"
            ? ({ hooks: groupedHooks } as { matcher?: string; hooks: Array<Record<string, unknown>> })
            : ({ matcher, hooks: groupedHooks } as { matcher?: string; hooks: Array<Record<string, unknown>> }),
        );

      events[mappedEvent] = [...(events[mappedEvent] ?? []), ...groupEntries];
    }
  }

  return stableStringify({ hooks: events });
}

export function renderCopilotHookConfig(hooks: ReadonlyArray<CanonicalHook>): string {
  const events: Record<string, Array<Record<string, unknown>>> = {};

  for (const hook of hooks) {
    for (const [eventName, handlers] of Object.entries(hook.events) as Array<
      [CanonicalHookEvent, CanonicalHook["events"][CanonicalHookEvent]]
    >) {
      const mappedEvent = COPILOT_EVENT_MAP[eventName];
      if (!mappedEvent) {
        handleUnsupported(hook, "copilot", `event '${eventName}'`);
        continue;
      }

      if (!handlers || handlers.length === 0) {
        continue;
      }

      for (const handler of handlers) {
        if (handler.type !== "command") {
          handleUnsupported(hook, "copilot", `handler type '${handler.type}'`);
          continue;
        }

        if (handler.matcher) {
          handleUnsupported(hook, "copilot", "matcher");
          continue;
        }

        const rendered = renderCopilotCommand(handler);
        if (!rendered) {
          handleUnsupported(hook, "copilot", "command fields");
          continue;
        }

        events[mappedEvent] = [...(events[mappedEvent] ?? []), rendered];
      }
    }
  }

  return stableStringify({
    version: 1,
    hooks: events,
  });
}

export function resolveCodexNotifyCommand(hooks: ReadonlyArray<CanonicalHook>): string[] | undefined {
  let notifyCommand: string[] | undefined;

  for (const hook of hooks) {
    for (const [eventName, handlers] of Object.entries(hook.events) as Array<
      [CanonicalHookEvent, CanonicalHook["events"][CanonicalHookEvent]]
    >) {
      if (eventName !== "turn_complete") {
        handleUnsupported(hook, "codex", `event '${eventName}'`);
        continue;
      }

      if (!handlers || handlers.length === 0) {
        continue;
      }

      for (const handler of handlers) {
        const command = resolveCodexHandlerCommand(hook, handler);
        if (!command) {
          continue;
        }

        if (!notifyCommand) {
          notifyCommand = command;
          continue;
        }

        if (!stringArrayEquals(notifyCommand, command)) {
          throw new Error(
            `HOOK_NOTIFY_CONFLICT: codex supports one notify command, but hook '${hook.id}' defines a different command`,
          );
        }
      }
    }
  }

  return notifyCommand;
}

function resolveCodexHandlerCommand(hook: CanonicalHook, handler: CanonicalHookHandler) {
  if (handler.type === "notify") {
    return stableHookCommandArray(handler.command);
  }

  if (handler.type === "command") {
    const command = resolveCodexCommand(handler);
    if (!command) {
      handleUnsupported(hook, "codex", "command fields");
      return undefined;
    }
    return stableHookCommandArray(command);
  }

  handleUnsupported(hook, "codex", `handler type '${(handler as { type?: string }).type ?? "unknown"}'`);
  return undefined;
}

function renderClaudeCommand(handler: CanonicalHookCommandHandler): Record<string, unknown> | undefined {
  const command = resolveGenericCommand(handler);
  if (!command) {
    return undefined;
  }

  const output: Record<string, unknown> = {
    type: "command",
    command,
  };

  if (handler.cwd) {
    output.cwd = handler.cwd;
  }
  if (handler.env) {
    output.env = handler.env;
  }

  const timeout = handler.timeout ?? handler.timeoutSec;
  if (timeout) {
    output.timeout = timeout;
  }

  return output;
}

function renderCopilotCommand(handler: CanonicalHookCommandHandler): Record<string, unknown> | undefined {
  const bash = handler.bash ?? handler.linux ?? handler.osx ?? handler.command;
  const powershell = handler.powershell ?? handler.windows ?? handler.command;

  if (!bash && !powershell) {
    return undefined;
  }

  const output: Record<string, unknown> = {
    type: "command",
  };

  if (bash) {
    output.bash = bash;
  }

  if (powershell) {
    output.powershell = powershell;
  }

  if (handler.cwd) {
    output.cwd = handler.cwd;
  }
  if (handler.env) {
    output.env = handler.env;
  }

  const timeoutSec = handler.timeoutSec ?? handler.timeout;
  if (timeoutSec) {
    output.timeoutSec = timeoutSec;
  }

  return output;
}

function resolveGenericCommand(handler: CanonicalHookCommandHandler): string | undefined {
  return handler.command ?? handler.bash ?? handler.linux ?? handler.osx ?? handler.powershell ?? handler.windows;
}

function resolveCodexCommand(handler: CanonicalHookCommandHandler): string | undefined {
  return resolveGenericCommand(handler);
}

function handleUnsupported(hook: CanonicalHook, provider: "codex" | "claude" | "copilot", capability: string): void {
  if (hook.mode === "best_effort") {
    return;
  }

  throw new Error(
    `HOOK_EVENT_UNSUPPORTED: provider '${provider}' does not support ${capability} used by hook '${hook.id}'`,
  );
}

function stringArrayEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
