import type {
  CanonicalHook,
  CanonicalHookCommandHandler,
  CanonicalHookHandler,
  CanonicalHookMode,
  CanonicalHookNotifyHandler,
  Diagnostic,
} from "./types.js";

export const CANONICAL_HOOK_EVENTS = [
  "session_start",
  "session_end",
  "prompt_submit",
  "pre_tool_use",
  "permission_request",
  "post_tool_use",
  "post_tool_failure",
  "notification",
  "subagent_start",
  "subagent_stop",
  "stop",
  "stop_failure",
  "teammate_idle",
  "task_completed",
  "instructions_loaded",
  "config_change",
  "worktree_create",
  "worktree_remove",
  "pre_compact",
  "post_compact",
  "elicitation",
  "elicitation_result",
  "error",
  "turn_complete",
] as const;

export type CanonicalHookEvent = (typeof CANONICAL_HOOK_EVENTS)[number];

const HOOK_EVENT_SET = new Set<string>(CANONICAL_HOOK_EVENTS);

export interface ParsedCanonicalHookDocument {
  mode: CanonicalHookMode;
  events: Partial<Record<CanonicalHookEvent, CanonicalHookHandler[]>>;
}

export function parseCanonicalHookDocument(
  input: unknown,
  sourcePath: string,
  entityId: string,
): { canonical?: ParsedCanonicalHookDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.push({
      code: "HOOK_JSON_INVALID",
      severity: "error",
      message: `Hook '${entityId}' must be a JSON object`,
      path: sourcePath,
      entityId,
    });
    return { diagnostics };
  }

  const objectValue = input as Record<string, unknown>;
  const mode = parseMode(objectValue.mode, sourcePath, entityId, diagnostics);
  const events = parseEvents(objectValue, sourcePath, entityId, diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  return {
    canonical: {
      mode,
      events,
    },
    diagnostics,
  };
}

function parseMode(input: unknown, sourcePath: string, entityId: string, diagnostics: Diagnostic[]): CanonicalHookMode {
  if (typeof input === "undefined") {
    return "strict";
  }

  if (input === "strict" || input === "best_effort") {
    return input;
  }

  diagnostics.push({
    code: "HOOK_MODE_INVALID",
    severity: "error",
    message: `Hook '${entityId}' has invalid mode; expected 'strict' or 'best_effort'`,
    path: sourcePath,
    entityId,
  });
  return "strict";
}

function parseEvents(
  input: Record<string, unknown>,
  sourcePath: string,
  entityId: string,
  diagnostics: Diagnostic[],
): Partial<Record<CanonicalHookEvent, CanonicalHookHandler[]>> {
  const output: Partial<Record<CanonicalHookEvent, CanonicalHookHandler[]>> = {};
  const candidate = (input.events ?? input.hooks) as unknown;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    diagnostics.push({
      code: "HOOK_EVENTS_INVALID",
      severity: "error",
      message: `Hook '${entityId}' must define an object at 'events'`,
      path: sourcePath,
      entityId,
    });
    return output;
  }

  const eventsObject = candidate as Record<string, unknown>;
  for (const [eventName, handlersValue] of Object.entries(eventsObject)) {
    if (!HOOK_EVENT_SET.has(eventName)) {
      diagnostics.push({
        code: "HOOK_EVENT_UNKNOWN",
        severity: "error",
        message: `Hook '${entityId}' uses unsupported canonical event '${eventName}'`,
        path: sourcePath,
        entityId,
      });
      continue;
    }

    if (!Array.isArray(handlersValue)) {
      diagnostics.push({
        code: "HOOK_EVENT_INVALID",
        severity: "error",
        message: `Hook '${entityId}' event '${eventName}' must be an array`,
        path: sourcePath,
        entityId,
      });
      continue;
    }

    const parsedHandlers: CanonicalHookHandler[] = [];
    handlersValue.forEach((handlerValue, index) => {
      const parsed = parseHandler(
        handlerValue,
        eventName as CanonicalHookEvent,
        sourcePath,
        entityId,
        index,
        diagnostics,
      );
      if (parsed) {
        parsedHandlers.push(parsed);
      }
    });

    if (parsedHandlers.length > 0) {
      output[eventName as CanonicalHookEvent] = parsedHandlers;
    }
  }

  return output;
}

function parseHandler(
  input: unknown,
  eventName: CanonicalHookEvent,
  sourcePath: string,
  entityId: string,
  index: number,
  diagnostics: Diagnostic[],
): CanonicalHookHandler | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.push({
      code: "HOOK_HANDLER_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} must be an object`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  const objectValue = input as Record<string, unknown>;
  const type = objectValue.type;

  if (type === "command") {
    return parseCommandHandler(objectValue, eventName, sourcePath, entityId, index, diagnostics);
  }

  if (type === "notify") {
    return parseNotifyHandler(objectValue, eventName, sourcePath, entityId, index, diagnostics);
  }

  diagnostics.push({
    code: "HOOK_HANDLER_TYPE_INVALID",
    severity: "error",
    message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} has invalid type`,
    path: sourcePath,
    entityId,
  });
  return undefined;
}

function parseCommandHandler(
  input: Record<string, unknown>,
  eventName: CanonicalHookEvent,
  sourcePath: string,
  entityId: string,
  index: number,
  diagnostics: Diagnostic[],
): CanonicalHookCommandHandler | undefined {
  const matcher = asOptionalString(input.matcher);
  const command = asOptionalString(input.command);
  const windows = asOptionalString(input.windows);
  const linux = asOptionalString(input.linux);
  const osx = asOptionalString(input.osx);
  const bash = asOptionalString(input.bash);
  const powershell = asOptionalString(input.powershell);
  const cwd = asOptionalString(input.cwd);
  const timeoutSec = asOptionalPositiveNumber(input.timeoutSec);
  const timeout = asOptionalPositiveNumber(input.timeout);
  const env = asOptionalStringMap(input.env);

  if (!command && !windows && !linux && !osx && !bash && !powershell) {
    diagnostics.push({
      code: "HOOK_COMMAND_MISSING",
      severity: "error",
      message:
        `Hook '${entityId}' event '${eventName}' handler #${index + 1} requires one of ` +
        "'command', 'windows', 'linux', 'osx', 'bash', or 'powershell'",
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  if (typeof input.timeoutSec !== "undefined" && typeof timeoutSec === "undefined") {
    diagnostics.push({
      code: "HOOK_TIMEOUT_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} has invalid timeoutSec`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  if (typeof input.timeout !== "undefined" && typeof timeout === "undefined") {
    diagnostics.push({
      code: "HOOK_TIMEOUT_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} has invalid timeout`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  if (typeof input.env !== "undefined" && typeof env === "undefined") {
    diagnostics.push({
      code: "HOOK_ENV_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} env must be an object of string values`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  return {
    type: "command",
    matcher,
    command,
    windows,
    linux,
    osx,
    bash,
    powershell,
    cwd,
    env,
    timeoutSec,
    timeout,
  };
}

function parseNotifyHandler(
  input: Record<string, unknown>,
  eventName: CanonicalHookEvent,
  sourcePath: string,
  entityId: string,
  index: number,
  diagnostics: Diagnostic[],
): CanonicalHookNotifyHandler | undefined {
  const rawEvent = input.event;
  const notifyEvent = typeof rawEvent === "undefined" ? "agent-turn-complete" : rawEvent;
  if (notifyEvent !== "agent-turn-complete") {
    diagnostics.push({
      code: "HOOK_NOTIFY_EVENT_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} only supports notify event 'agent-turn-complete'`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  const command = parseNotifyCommand(input.command);
  if (!command) {
    diagnostics.push({
      code: "HOOK_NOTIFY_COMMAND_INVALID",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} notify command must be a string or non-empty string array`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  if (typeof input.matcher !== "undefined") {
    diagnostics.push({
      code: "HOOK_NOTIFY_MATCHER_UNSUPPORTED",
      severity: "error",
      message: `Hook '${entityId}' event '${eventName}' handler #${index + 1} notify handlers do not support matcher`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  return {
    type: "notify",
    event: "agent-turn-complete",
    command,
  };
}

function parseNotifyCommand(input: unknown): string | string[] | undefined {
  if (typeof input === "string" && input.trim().length > 0) {
    return input;
  }

  if (!Array.isArray(input)) {
    return undefined;
  }

  const command = input.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return command.length > 0 ? command : undefined;
}

function asOptionalString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  return value.length > 0 ? value : undefined;
}

function asOptionalPositiveNumber(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
    return undefined;
  }
  return input;
}

function asOptionalStringMap(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      return undefined;
    }
    output[key] = value;
  }
  return output;
}

export function canonicalHookHasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function stableHookCommandArray(command: string | string[]): string[] {
  if (Array.isArray(command)) {
    return command;
  }

  return ["sh", "-lc", command];
}

export function withHookId(hook: ParsedCanonicalHookDocument, id: string): CanonicalHook {
  return {
    id,
    mode: hook.mode,
    events: hook.events,
  };
}
