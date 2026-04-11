import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "./types.js";

export interface DocTopic {
  id: string;
  title: string;
  content: string;
}

export interface DocsSearchResult {
  id: string;
  title: string;
  excerpts: string[];
}

const TOOLKIT_PREFIX = "toolkit.";

function fileToTopicId(relativePath: string): string {
  const stem = relativePath.replace(/\.md$/, "").replaceAll("/", ".");
  return stem.startsWith(TOOLKIT_PREFIX) ? stem.slice(TOOLKIT_PREFIX.length) : stem;
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "(untitled)";
}

export function resolveDocsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // From src/docs.ts or dist/docs.js → packages/toolkit/ → packages/ → repo root → docs/
  const packageRoot = join(thisFile, "..", "..");
  const repoRoot = join(packageRoot, "..", "..");
  return join(repoRoot, "docs");
}

export async function loadDocTopics(docsDir: string): Promise<{ topics: DocTopic[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];

  let entries: string[];
  try {
    entries = await collectMarkdownFiles(docsDir, "");
  } catch {
    diagnostics.push({
      code: "DOCS_DIR_NOT_FOUND",
      severity: "error",
      message: `Documentation directory not found: ${docsDir}`,
    });
    return { topics: [], diagnostics };
  }

  const topics: DocTopic[] = [];
  for (const relativePath of entries.sort()) {
    const content = await readFile(join(docsDir, relativePath), "utf-8");
    topics.push({
      id: fileToTopicId(relativePath),
      title: extractTitle(content),
      content,
    });
  }

  return { topics, diagnostics };
}

async function collectMarkdownFiles(baseDir: string, prefix: string): Promise<string[]> {
  const dirEntries = await readdir(join(baseDir, prefix), { withFileTypes: true });
  const results: string[] = [];

  for (const entry of dirEntries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownFiles(baseDir, relative)));
    } else if (entry.name.endsWith(".md")) {
      results.push(relative);
    }
  }

  return results;
}

export function findTopic(topics: readonly DocTopic[], query: string): DocTopic | undefined {
  const lower = query.toLowerCase();
  // Exact id match (e.g. "cli", "hook-authoring")
  const exact = topics.find((t) => t.id === lower);
  if (exact) return exact;
  // Accept full filename stem with toolkit. prefix (e.g. "toolkit.cli" resolves to id "cli")
  const withPrefix = topics.find((t) => `${TOOLKIT_PREFIX}${t.id}` === lower);
  if (withPrefix) return withPrefix;
  return undefined;
}

export function searchDocs(topics: readonly DocTopic[], query: string): DocsSearchResult[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];

  const results: DocsSearchResult[] = [];

  for (const topic of topics) {
    const excerpts: string[] = [];
    const lines = topic.content.split("\n");

    // Check title/id match
    if (topic.title.toLowerCase().includes(lower) || topic.id.toLowerCase().includes(lower)) {
      excerpts.push(topic.title);
    }

    // Check body lines, avoiding overlapping excerpts
    let lastEmitted = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.toLowerCase().includes(lower) && i > lastEmitted) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        excerpts.push(lines.slice(start, end).join("\n"));
        lastEmitted = end;
        if (excerpts.length >= 4) break;
      }
    }

    if (excerpts.length > 0) {
      results.push({ id: topic.id, title: topic.title, excerpts });
    }
  }

  return results;
}
