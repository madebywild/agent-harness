import type { CanonicalSubagent, ProviderOverride } from "../types.js";
import { withSingleTrailingNewline } from "../utils.js";

interface SubagentOptionsObject {
  [key: string]: unknown;
}

export interface CodexSubagentOptions {
  model?: string;
  reasoning?: string;
  sandboxMode?: string;
  tools?: string[];
  mcpServers?: Record<string, unknown>;
  skillsConfig?: Array<Record<string, unknown>>;
  nicknameCandidates?: string[];
}

export interface ClaudeSubagentOptions {
  model?: string;
  tools?: string | string[];
  disallowedTools?: string | string[];
  permissionMode?: string;
  mcpServers?: string[];
  maxTurns?: number;
}

export interface CopilotSubagentOptions {
  model?: string | string[];
  tools?: string[];
  handoffs?: string[];
  agents?: string[];
  mcpServers?: string[];
}

export interface CursorSubagentOptions {
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
}

export function parseCodexSubagentOptions(override?: ProviderOverride): CodexSubagentOptions {
  const options = readOptionsObject(override);
  const skills = asRecord(options.skills);
  return {
    model: asString(options.model),
    reasoning: asString(readNamedOption(options, ["reasoning", "model_reasoning_effort", "modelReasoningEffort"])),
    sandboxMode: asString(readNamedOption(options, ["sandbox_mode", "sandboxMode"])),
    tools: asStringArray(options.tools),
    mcpServers: asRecord(readNamedOption(options, ["mcp_servers", "mcpServers"])),
    skillsConfig:
      asRecordArray(readNamedOption(options, ["skills.config", "skillsConfig", "skills-config"])) ??
      asRecordArray(skills?.config),
    nicknameCandidates: asStringArray(readNamedOption(options, ["nickname_candidates", "nicknameCandidates"])),
  };
}

export function parseClaudeSubagentOptions(override?: ProviderOverride): ClaudeSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model),
    tools: asString(options.tools) ?? asStringArray(options.tools),
    disallowedTools:
      asString(readNamedOption(options, ["disallowedTools", "disallowed-tools"])) ??
      asStringArray(readNamedOption(options, ["disallowedTools", "disallowed-tools"])),
    permissionMode: asString(readNamedOption(options, ["permissionMode", "permission-mode"])),
    mcpServers: asStringArray(readNamedOption(options, ["mcpServers", "mcp-servers"])),
    maxTurns: asNumber(readNamedOption(options, ["maxTurns", "max-turns"])),
  };
}

export function parseCopilotSubagentOptions(override?: ProviderOverride): CopilotSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model) ?? asStringArray(options.model),
    tools: asStringArray(options.tools),
    handoffs: asStringArray(options.handoffs),
    agents: asStringArray(options.agents),
    mcpServers: asStringArray(readNamedOption(options, ["mcpServers", "mcp-servers"])),
  };
}

export function parseCursorSubagentOptions(override?: ProviderOverride): CursorSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model),
    readonly: asBoolean(options.readonly),
    isBackground: asBoolean(options.is_background),
  };
}

export function renderSubagentMarkdown(
  input: CanonicalSubagent,
  extraFrontmatter: Record<string, string | string[] | boolean | number | undefined>,
): string {
  const entries: Array<[string, string | string[] | boolean | number]> = [
    ["name", input.name],
    ["description", input.description],
  ];

  for (const [key, value] of Object.entries(extraFrontmatter)) {
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }

  const frontmatterLines = entries.map(([key, value]) => `${key}: ${serializeYamlPrimitive(value)}`);
  const body = input.body.trim();
  return withSingleTrailingNewline(["---", ...frontmatterLines, "---", "", body].join("\n"));
}

function readOptionsObject(override?: ProviderOverride): SubagentOptionsObject {
  const candidate = override?.options;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }
  return candidate;
}

function readNamedOption(options: SubagentOptionsObject, keys: string[]): unknown {
  for (const key of keys) {
    if (key in options) {
      return options[key];
    }
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const output = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return output.length > 0 ? output : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const output = value.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
  return output.length > 0 ? output : undefined;
}

function serializeYamlPrimitive(value: string | string[] | boolean | number): string {
  return JSON.stringify(value);
}
