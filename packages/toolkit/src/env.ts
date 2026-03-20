import type { HarnessPaths } from "./paths.js";
import type { Diagnostic } from "./types.js";
import { readTextIfExists } from "./utils.js";

/**
 * Parse a dotenv-format string into key-value pairs.
 * - Lines starting with # are comments
 * - Empty lines are skipped
 * - Format: KEY=value (value can be unquoted, double-quoted, or single-quoted)
 * - Double-quoted values support \n, \t, \\, \" escapes
 * - Single-quoted values are literal (no escape processing)
 * - Unquoted values are trimmed and stop at inline # comments
 */
export function parseEnvFile(content: string): Map<string, string> {
  const vars = new Map<string, string>();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = trimmed.slice(equalsIndex + 1);

    if (rawValue.startsWith('"')) {
      // Double-quoted value: find matching closing quote
      const closingIndex = findClosingDoubleQuote(rawValue, 1);
      if (closingIndex !== -1) {
        const inner = rawValue.slice(1, closingIndex);
        vars.set(key, processDoubleQuotedEscapes(inner));
      } else {
        // No closing quote — treat as unquoted
        vars.set(key, rawValue.trim());
      }
    } else if (rawValue.startsWith("'")) {
      // Single-quoted value: find matching closing quote (literal, no escapes)
      const closingIndex = rawValue.indexOf("'", 1);
      if (closingIndex !== -1) {
        vars.set(key, rawValue.slice(1, closingIndex));
      } else {
        // No closing quote — treat as unquoted
        vars.set(key, rawValue.trim());
      }
    } else {
      // Unquoted value: trim and stop at inline # comments
      const commentIndex = rawValue.indexOf(" #");
      const value = commentIndex !== -1 ? rawValue.slice(0, commentIndex) : rawValue;
      vars.set(key, value.trim());
    }
  }

  return vars;
}

function findClosingDoubleQuote(text: string, startIndex: number): number {
  let i = startIndex;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2; // skip escaped char
      continue;
    }
    if (text[i] === '"') {
      return i;
    }
    i++;
  }
  return -1;
}

function processDoubleQuotedEscapes(value: string): string {
  let result = "";
  let i = 0;
  while (i < value.length) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      switch (next) {
        case "n":
          result += "\n";
          break;
        case "t":
          result += "\t";
          break;
        case "\\":
          result += "\\";
          break;
        case '"':
          result += '"';
          break;
        default:
          result += `\\${next}`;
          break;
      }
      i += 2;
    } else {
      result += value[i];
      i++;
    }
  }
  return result;
}

/**
 * Load env vars from multiple sources with precedence:
 * 1. .harness/.env (highest priority)
 * 2. .env.harness (at project root)
 * 3. process.env (lowest priority, fallback for CI/CD — handled in substituteEnvVars)
 *
 * Higher-priority sources override lower-priority ones.
 * Missing files are silently skipped.
 * Returns the merged map + diagnostics for parse errors.
 */
export async function loadEnvVars(
  paths: HarnessPaths,
): Promise<{ vars: Map<string, string>; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const merged = new Map<string, string>();

  // Load sources in order from lowest to highest priority
  const sources: Array<{ filePath: string; displayPath: string }> = [
    {
      filePath: paths.rootEnvFile,
      displayPath: ".env.harness",
    },
    {
      filePath: paths.envFile,
      displayPath: ".harness/.env",
    },
  ];

  for (const source of sources) {
    const text = await readTextIfExists(source.filePath);
    if (text === null) {
      continue;
    }

    try {
      const parsed = parseEnvFile(text);
      for (const [key, value] of parsed) {
        merged.set(key, value);
      }
    } catch (error) {
      diagnostics.push({
        code: "ENV_FILE_PARSE_ERROR",
        severity: "warning",
        message: `Failed to parse env file '${source.displayPath}': ${error instanceof Error ? error.message : "unknown error"}`,
        path: source.displayPath,
      });
    }
  }

  return { vars: merged, diagnostics };
}

const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Replace {{PLACEHOLDER}} patterns in text with env var values.
 * Pattern: \{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}
 * Returns the substituted text, set of used keys, and array of unresolved placeholder names.
 *
 * When a placeholder key is not found in `vars`, process.env is checked as a fallback.
 */
export function substituteEnvVars(
  text: string,
  vars: Map<string, string>,
): { result: string; usedKeys: Set<string>; unresolvedKeys: string[] } {
  const usedKeys = new Set<string>();
  const unresolvedKeys: string[] = [];

  const result = text.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = vars.get(key) ?? process.env[key];
    if (value !== undefined) {
      usedKeys.add(key);
      return value;
    }
    unresolvedKeys.push(key);
    return match;
  });

  return { result, usedKeys, unresolvedKeys };
}
