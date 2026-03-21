import matter from "gray-matter";
import type { CanonicalCommand, Diagnostic } from "./types.js";

export interface ParsedCanonicalCommandDocument {
  description: string;
  argumentHint?: string;
  body: string;
}

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
  const argumentHint =
    typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"].trim() : undefined;
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

  return {
    diagnostics,
    canonical: {
      id: entityId,
      description,
      argumentHint: argumentHint || undefined,
      body,
    },
  };
}
