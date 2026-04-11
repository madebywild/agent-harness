import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { findTopic, loadDocTopics, searchDocs } from "../src/docs.ts";
import { mkTmpRepo } from "./helpers.ts";

async function createDocsFixture(dir: string, files: Record<string, string>): Promise<string> {
  const docsDir = path.join(dir, "docs");
  await fs.mkdir(docsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(docsDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return docsDir;
}

test("loadDocTopics loads markdown files and extracts titles", async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "toolkit.cli.md": "# CLI Module\n\nThe CLI entrypoint.\n",
    "architecture.md": "# Architecture\n\nHigh-level overview.\n",
  });

  const { topics, diagnostics } = await loadDocTopics(docsDir);

  assert.equal(diagnostics.length, 0);
  assert.equal(topics.length, 2);

  const arch = topics.find((t) => t.id === "architecture");
  assert.ok(arch);
  assert.equal(arch.title, "Architecture");

  const cli = topics.find((t) => t.id === "cli");
  assert.ok(cli);
  assert.equal(cli.title, "CLI Module");

  await fs.rm(tmp, { recursive: true });
});

test("loadDocTopics strips toolkit. prefix from topic ids", async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "toolkit.provider.claude.md": "# Claude Provider\n\nDetails.\n",
    "hook-authoring.md": "# Hook Authoring\n\nGuide.\n",
  });

  const { topics } = await loadDocTopics(docsDir);

  assert.ok(topics.find((t) => t.id === "provider.claude"));
  assert.ok(topics.find((t) => t.id === "hook-authoring"));

  await fs.rm(tmp, { recursive: true });
});

test("loadDocTopics handles subdirectories with dot notation", async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "architecture/versioning.md": "# Versioning\n\nHow versions work.\n",
  });

  const { topics } = await loadDocTopics(docsDir);

  assert.equal(topics.length, 1);
  assert.equal(topics[0]!.id, "architecture.versioning");

  await fs.rm(tmp, { recursive: true });
});

test("loadDocTopics returns diagnostic when docs dir missing", async () => {
  const { topics, diagnostics } = await loadDocTopics("/nonexistent/docs");

  assert.equal(topics.length, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, "DOCS_DIR_NOT_FOUND");
});

test("findTopic matches by exact id", async () => {
  const topics = [
    { id: "cli", title: "CLI", content: "# CLI\n" },
    { id: "engine", title: "Engine", content: "# Engine\n" },
  ];

  assert.equal(findTopic(topics, "cli")?.id, "cli");
  assert.equal(findTopic(topics, "engine")?.id, "engine");
});

test("findTopic matches with toolkit. prefix", async () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];

  assert.equal(findTopic(topics, "toolkit.cli")?.id, "cli");
});

test("findTopic is case-insensitive", async () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];

  assert.equal(findTopic(topics, "CLI")?.id, "cli");
  assert.equal(findTopic(topics, "Toolkit.CLI")?.id, "cli");
});

test("findTopic returns undefined for unknown topic", async () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];

  assert.equal(findTopic(topics, "nonexistent"), undefined);
});

test("searchDocs finds matches in title and body", async () => {
  const topics = [
    { id: "cli", title: "CLI Module", content: "# CLI Module\n\nThe CLI entrypoint.\n" },
    { id: "engine", title: "Engine", content: "# Engine\n\nOrchestrates everything.\n" },
  ];

  const results = searchDocs(topics, "CLI");

  assert.equal(results.length, 1);
  assert.equal(results[0]!.id, "cli");
  assert.ok(results[0]!.excerpts.length > 0);
});

test("searchDocs returns empty for empty query", async () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];

  assert.deepEqual(searchDocs(topics, ""), []);
  assert.deepEqual(searchDocs(topics, "   "), []);
});

test("searchDocs returns empty when no matches", async () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];

  assert.deepEqual(searchDocs(topics, "zzzznonexistent"), []);
});

test("searchDocs avoids overlapping excerpts", async () => {
  const lines = Array.from({ length: 20 }, (_, i) => `Line ${i} contains keyword`);
  const topics = [{ id: "test", title: "Test", content: lines.join("\n") }];

  const results = searchDocs(topics, "keyword");

  assert.equal(results.length, 1);
  // Should have title + limited body excerpts, not one per line
  assert.ok(results[0]!.excerpts.length <= 5);
});
