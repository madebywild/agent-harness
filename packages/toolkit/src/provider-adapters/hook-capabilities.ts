import type { CanonicalHookEvent, ProviderId } from "../types.js";

export interface HookEventCapability {
  nativeEvent: string;
  matcher: boolean;
}

export interface HookCommandCapability {
  timeoutKey: "timeout" | "timeoutSec";
  supportsCwd: boolean;
  supportsEnv: boolean;
  supportsStatusMessage: boolean;
}

export interface HookProviderCapabilities {
  events: Partial<Record<CanonicalHookEvent, HookEventCapability>>;
  command: HookCommandCapability;
}

function event(nativeEvent: string, matcher = false): HookEventCapability {
  return { nativeEvent, matcher };
}

export const HOOK_PROVIDER_CAPABILITIES = {
  claude: {
    events: {
      session_start: event("SessionStart", true),
      session_end: event("SessionEnd", true),
      prompt_submit: event("UserPromptSubmit"),
      pre_tool_use: event("PreToolUse", true),
      permission_request: event("PermissionRequest", true),
      post_tool_use: event("PostToolUse", true),
      post_tool_failure: event("PostToolUseFailure", true),
      notification: event("Notification", true),
      subagent_start: event("SubagentStart", true),
      subagent_stop: event("SubagentStop", true),
      stop: event("Stop"),
      stop_failure: event("StopFailure", true),
      teammate_idle: event("TeammateIdle"),
      task_completed: event("TaskCompleted"),
      instructions_loaded: event("InstructionsLoaded", true),
      config_change: event("ConfigChange", true),
      worktree_create: event("WorktreeCreate"),
      worktree_remove: event("WorktreeRemove"),
      pre_compact: event("PreCompact", true),
      post_compact: event("PostCompact", true),
      elicitation: event("Elicitation", true),
      elicitation_result: event("ElicitationResult", true),
      setup: event("Setup"),
      user_prompt_expansion: event("UserPromptExpansion"),
      permission_denied: event("PermissionDenied"),
      post_tool_batch: event("PostToolBatch", true),
      cwd_changed: event("CwdChanged"),
      file_changed: event("FileChanged", true),
      task_created: event("TaskCreated"),
    },
    command: {
      timeoutKey: "timeout",
      supportsCwd: true,
      supportsEnv: true,
      supportsStatusMessage: false,
    },
  },
  codex: {
    events: {
      session_start: event("SessionStart", true),
      prompt_submit: event("UserPromptSubmit"),
      pre_tool_use: event("PreToolUse", true),
      permission_request: event("PermissionRequest", true),
      post_tool_use: event("PostToolUse", true),
      subagent_start: event("SubagentStart", true),
      subagent_stop: event("SubagentStop", true),
      pre_compact: event("PreCompact", true),
      post_compact: event("PostCompact", true),
      stop: event("Stop"),
    },
    command: {
      timeoutKey: "timeout",
      supportsCwd: false,
      supportsEnv: false,
      supportsStatusMessage: true,
    },
  },
  copilot: {
    events: {
      session_start: event("sessionStart"),
      session_end: event("sessionEnd"),
      prompt_submit: event("userPromptSubmitted"),
      pre_tool_use: event("preToolUse"),
      post_tool_use: event("postToolUse"),
      pre_compact: event("preCompact"),
      stop: event("agentStop"),
      subagent_start: event("subagentStart"),
      subagent_stop: event("subagentStop"),
      error: event("errorOccurred"),
    },
    command: {
      timeoutKey: "timeoutSec",
      supportsCwd: true,
      supportsEnv: true,
      supportsStatusMessage: false,
    },
  },
  cursor: {
    events: {
      session_start: event("sessionStart", true),
      session_end: event("sessionEnd", true),
      prompt_submit: event("beforeSubmitPrompt", true),
      pre_tool_use: event("preToolUse", true),
      post_tool_use: event("postToolUse", true),
      post_tool_failure: event("postToolUseFailure", true),
      subagent_start: event("subagentStart", true),
      subagent_stop: event("subagentStop", true),
      pre_compact: event("preCompact", true),
      stop: event("stop", true),
    },
    command: {
      timeoutKey: "timeout",
      supportsCwd: false,
      supportsEnv: false,
      supportsStatusMessage: false,
    },
  },
} as const satisfies Record<ProviderId, HookProviderCapabilities>;

export function getHookEventCapability(
  provider: ProviderId,
  eventName: CanonicalHookEvent,
): HookEventCapability | undefined {
  const events: Partial<Record<CanonicalHookEvent, HookEventCapability>> = HOOK_PROVIDER_CAPABILITIES[provider].events;
  return events[eventName];
}

export function nativeToCanonicalHookEvent(provider: ProviderId, nativeEvent: string): CanonicalHookEvent | undefined {
  const events: Partial<Record<CanonicalHookEvent, HookEventCapability>> = HOOK_PROVIDER_CAPABILITIES[provider].events;
  for (const [canonicalEvent, capability] of Object.entries(events) as Array<
    [CanonicalHookEvent, HookEventCapability]
  >) {
    if (capability.nativeEvent === nativeEvent) {
      return canonicalEvent;
    }
  }

  return undefined;
}
