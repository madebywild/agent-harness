import type { CanonicalSubagent, ProviderOverride } from "../types.js";
import { withSingleTrailingNewline } from "../utils.js";

interface SubagentOptionsObject {
  [key: string]: unknown;
}

export interface CodexSubagentOptions {
  model?: string;
  tools?: string[];
}

export interface ClaudeSubagentOptions {
  model?: string;
  tools?: string | string[];
}

export interface CopilotSubagentOptions {
  model?: string;
  tools?: string[];
  handoffs?: string[];
}

export interface CursorSubagentOptions {
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
}

export function parseCodexSubagentOptions(override?: ProviderOverride): CodexSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model),
    tools: asStringArray(options.tools),
  };
}

export function parseClaudeSubagentOptions(override?: ProviderOverride): ClaudeSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model),
    tools: asString(options.tools) ?? asStringArray(options.tools),
  };
}

export function parseCopilotSubagentOptions(override?: ProviderOverride): CopilotSubagentOptions {
  const options = readOptionsObject(override);
  return {
    model: asString(options.model),
    tools: asStringArray(options.tools),
    handoffs: asStringArray(options.handoffs),
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
  extraFrontmatter: Record<string, string | string[] | boolean | undefined>,
): string {
  const entries: Array<[string, string | string[] | boolean]> = [
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

function serializeYamlPrimitive(value: string | string[] | boolean): string {
  return JSON.stringify(value);
}
