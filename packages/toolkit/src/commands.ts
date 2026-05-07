import matter from "gray-matter";
import type { CanonicalCommand, Diagnostic } from "./types.js";

export function parseCanonicalCommandDocument(
  raw: string,
  sourcePath: string,
  entityId: string,
): { canonical?: CanonicalCommand; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (error) {
    diagnostics.push({
      code: "COMMAND_FRONTMATTER_INVALID",
      severity: "error",
      message: `Command '${entityId}' frontmatter is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      path: sourcePath,
      entityId,
    });
    return { diagnostics };
  }

  const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  const argumentHint = optionalString(frontmatter["argument-hint"]);
  const name = optionalString(frontmatter.name);
  const model = optionalString(frontmatter.model);
  const agent = optionalString(frontmatter.agent);
  const tools = parseToolsField(frontmatter.tools, sourcePath, entityId, diagnostics);
  const body = parsed.content.trim();

  if (!description) {
    diagnostics.push({
      code: "COMMAND_DESCRIPTION_MISSING",
      severity: "error",
      message: `Command '${entityId}' requires a non-empty frontmatter description`,
      path: sourcePath,
      entityId,
    });
    return { diagnostics };
  }

  if (diagnostics.some((d) => d.severity === "error")) {
    return { diagnostics };
  }

  return {
    diagnostics,
    canonical: {
      id: entityId,
      description,
      argumentHint,
      name,
      model,
      tools,
      agent,
      body,
    },
  };
}

function optionalString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  return value.length > 0 ? value : undefined;
}

function parseToolsField(
  input: unknown,
  sourcePath: string,
  entityId: string,
  diagnostics: Diagnostic[],
): string[] | undefined {
  if (typeof input === "undefined") {
    return undefined;
  }

  if (typeof input === "string") {
    const value = input.trim();
    return value.length > 0 ? [value] : undefined;
  }

  if (!Array.isArray(input)) {
    diagnostics.push({
      code: "COMMAND_TOOLS_INVALID",
      severity: "error",
      message: `Command '${entityId}' frontmatter 'tools' must be a string or array of strings`,
      path: sourcePath,
      entityId,
    });
    return undefined;
  }

  const tools: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      diagnostics.push({
        code: "COMMAND_TOOLS_INVALID",
        severity: "error",
        message: `Command '${entityId}' frontmatter 'tools' must contain only non-empty strings`,
        path: sourcePath,
        entityId,
      });
      return undefined;
    }
    tools.push(entry.trim());
  }
  return tools.length > 0 ? tools : undefined;
}
