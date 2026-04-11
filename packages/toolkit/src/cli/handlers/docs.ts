import { findTopic, loadDocTopics, resolveDocsDir, searchDocs, toTopicSummaries } from "../../docs.js";
import type { DocsOutput } from "../contracts.js";

interface DocsInput {
  topic?: string;
  search?: string;
  docsDir?: string;
}

export async function handleDocs(input: DocsInput): Promise<DocsOutput> {
  const docsDir = input.docsDir ?? resolveDocsDir();
  const { topics, diagnostics } = await loadDocTopics(docsDir);

  if (diagnostics.some((d) => d.severity === "error")) {
    return {
      family: "docs",
      command: "docs",
      ok: false,
      diagnostics,
      exitCode: 1,
      data: { operation: "list", topics: [] },
    };
  }

  // Search mode (takes precedence over topic when both provided)
  if (input.search) {
    const results = searchDocs(topics, input.search);
    return {
      family: "docs",
      command: "docs",
      ok: true,
      diagnostics,
      exitCode: 0,
      data: { operation: "search", query: input.search, results },
    };
  }

  // Show specific topic
  if (input.topic) {
    const topic = findTopic(topics, input.topic);
    if (!topic) {
      return {
        family: "docs",
        command: "docs",
        ok: false,
        diagnostics: [
          ...diagnostics,
          {
            code: "DOCS_TOPIC_NOT_FOUND",
            severity: "error",
            message: `Topic '${input.topic}' not found. Run 'harness docs' to list available topics.`,
          },
        ],
        exitCode: 1,
        data: { operation: "show", topic: null },
      };
    }
    return {
      family: "docs",
      command: "docs",
      ok: true,
      diagnostics,
      exitCode: 0,
      data: { operation: "show", topic: { id: topic.id, title: topic.title, content: topic.content } },
    };
  }

  // List all topics
  return {
    family: "docs",
    command: "docs",
    ok: true,
    diagnostics,
    exitCode: 0,
    data: { operation: "list", topics: toTopicSummaries(topics) },
  };
}
