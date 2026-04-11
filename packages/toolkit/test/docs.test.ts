import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { handleDocs } from "../src/cli/handlers/docs.ts";
import { fileToTopicId, findTopic, loadDocTopics, searchDocs, toTopicSummaries } from "../src/docs.ts";
import { mkTmpRepo } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function withDocsFixture(files: Record<string, string>, fn: (docsDir: string) => Promise<void>): Promise<void> {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, files);
  try {
    await fn(docsDir);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// fileToTopicId
// ---------------------------------------------------------------------------

test("fileToTopicId strips toolkit. prefix and .md extension", () => {
  assert.equal(fileToTopicId("toolkit.cli.md"), "cli");
  assert.equal(fileToTopicId("toolkit.provider.claude.md"), "provider.claude");
});

test("fileToTopicId keeps non-prefixed names as-is", () => {
  assert.equal(fileToTopicId("hook-authoring.md"), "hook-authoring");
  assert.equal(fileToTopicId("architecture.md"), "architecture");
});

test("fileToTopicId converts subdirectory paths to dot notation", () => {
  assert.equal(fileToTopicId("architecture/versioning.md"), "architecture.versioning");
  assert.equal(fileToTopicId("a/b/c/deep.md"), "a.b.c.deep");
});

test("fileToTopicId returns raw stem for toolkit.md (edge case)", () => {
  assert.equal(fileToTopicId("toolkit.md"), "toolkit");
});

test("fileToTopicId returns empty string for .md (no name)", () => {
  assert.equal(fileToTopicId(".md"), "");
});

// ---------------------------------------------------------------------------
// toTopicSummaries
// ---------------------------------------------------------------------------

test("toTopicSummaries strips content from topics", () => {
  const topics = [
    { id: "cli", title: "CLI", content: "# CLI\nBody.\n" },
    { id: "engine", title: "Engine", content: "# Engine\nBody.\n" },
  ];
  const summaries = toTopicSummaries(topics);
  assert.deepEqual(summaries, [
    { id: "cli", title: "CLI" },
    { id: "engine", title: "Engine" },
  ]);
});

// ---------------------------------------------------------------------------
// loadDocTopics
// ---------------------------------------------------------------------------

test("loadDocTopics loads markdown files and extracts titles", async () => {
  await withDocsFixture(
    {
      "toolkit.cli.md": "# CLI Module\n\nThe CLI entrypoint.\n",
      "architecture.md": "# Architecture\n\nHigh-level overview.\n",
    },
    async (docsDir) => {
      const { topics, diagnostics } = await loadDocTopics(docsDir);
      assert.equal(diagnostics.length, 0);
      assert.deepEqual(topics.map((t) => t.id).sort(), ["architecture", "cli"]);
      assert.equal(topics.find((t) => t.id === "cli")?.title, "CLI Module");
      assert.equal(topics.find((t) => t.id === "architecture")?.title, "Architecture");
    },
  );
});

test("loadDocTopics strips toolkit. prefix from topic ids", async () => {
  await withDocsFixture(
    {
      "toolkit.provider.claude.md": "# Claude Provider\n\nDetails.\n",
      "hook-authoring.md": "# Hook Authoring\n\nGuide.\n",
    },
    async (docsDir) => {
      const { topics } = await loadDocTopics(docsDir);
      assert.ok(topics.find((t) => t.id === "provider.claude"));
      assert.ok(topics.find((t) => t.id === "hook-authoring"));
    },
  );
});

test("loadDocTopics handles subdirectories with dot notation", async () => {
  await withDocsFixture({ "architecture/versioning.md": "# Versioning\n\nHow versions work.\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "architecture.versioning");
  });
});

test("loadDocTopics handles deeply nested subdirectories", async () => {
  await withDocsFixture({ "a/b/c/deep.md": "# Deep Topic\n\nNested content.\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "a.b.c.deep");
    assert.equal(topics[0]?.title, "Deep Topic");
  });
});

test("loadDocTopics returns diagnostic when docs dir missing", async () => {
  const { topics, diagnostics } = await loadDocTopics("/nonexistent/docs");
  assert.equal(topics.length, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "DOCS_DIR_NOT_FOUND");
});

test("loadDocTopics returns empty topics for empty docs directory", async () => {
  await withDocsFixture({}, async (docsDir) => {
    const { topics, diagnostics } = await loadDocTopics(docsDir);
    assert.equal(diagnostics.length, 0);
    assert.equal(topics.length, 0);
  });
});

test("loadDocTopics ignores non-markdown files", async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, { "readme.md": "# README\n" });
  await fs.writeFile(path.join(docsDir, "notes.txt"), "not markdown");
  await fs.writeFile(path.join(docsDir, "data.json"), "{}");
  try {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "readme");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("loadDocTopics assigns (untitled) when file has no h1 heading", async () => {
  await withDocsFixture({ "no-heading.md": "No heading here\nJust text.\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics[0]?.title, "(untitled)");
  });
});

test("loadDocTopics does not use h2 as title", async () => {
  await withDocsFixture({ "h2-only.md": "## Sub Heading\nBody text.\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics[0]?.title, "(untitled)");
  });
});

test("loadDocTopics extracts title from first h1 even if not on first line", async () => {
  await withDocsFixture({ "late-heading.md": "\n\n# Late Heading\nBody text.\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics[0]?.title, "Late Heading");
  });
});

test("loadDocTopics skips files that produce empty topic ids", async () => {
  await withDocsFixture({ ".md": "# Empty Name\n", "valid.md": "# Valid\n" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "valid");
  });
});

test("loadDocTopics skips symlinked files", async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, { "real.md": "# Real\n" });
  const outsideFile = path.join(tmp, "outside.md");
  await fs.writeFile(outsideFile, "# Secret\n");
  await fs.symlink(outsideFile, path.join(docsDir, "linked.md"));
  try {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "real");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("loadDocTopics emits DOCS_FILE_UNREADABLE for unreadable files", {
  skip: process.getuid?.() === 0 && "root bypasses file permissions",
}, async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "readable.md": "# Readable\n",
    "broken.md": "# Broken\n",
  });
  await fs.chmod(path.join(docsDir, "broken.md"), 0o000);
  try {
    const { topics, diagnostics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.id, "readable");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.code, "DOCS_FILE_UNREADABLE");
    assert.equal(diagnostics[0]?.severity, "warning");
  } finally {
    await fs.chmod(path.join(docsDir, "broken.md"), 0o644);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("loadDocTopics handles empty files gracefully", async () => {
  await withDocsFixture({ "empty.md": "" }, async (docsDir) => {
    const { topics } = await loadDocTopics(docsDir);
    assert.equal(topics.length, 1);
    assert.equal(topics[0]?.title, "(untitled)");
    assert.equal(topics[0]?.content, "");
  });
});

// ---------------------------------------------------------------------------
// findTopic
// ---------------------------------------------------------------------------

test("findTopic trims whitespace from query", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.equal(findTopic(topics, "  cli  ")?.id, "cli");
});

test("findTopic matches by exact id", () => {
  const topics = [
    { id: "cli", title: "CLI", content: "# CLI\n" },
    { id: "engine", title: "Engine", content: "# Engine\n" },
  ];
  assert.equal(findTopic(topics, "cli")?.id, "cli");
  assert.equal(findTopic(topics, "engine")?.id, "engine");
});

test("findTopic matches with toolkit. prefix", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.equal(findTopic(topics, "toolkit.cli")?.id, "cli");
});

test("findTopic is case-insensitive", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.equal(findTopic(topics, "CLI")?.id, "cli");
  assert.equal(findTopic(topics, "Toolkit.CLI")?.id, "cli");
});

test("findTopic returns undefined for unknown topic", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.equal(findTopic(topics, "nonexistent"), undefined);
});

// ---------------------------------------------------------------------------
// searchDocs
// ---------------------------------------------------------------------------

test("searchDocs finds matches in title and body", () => {
  const topics = [
    { id: "cli", title: "CLI Module", content: "# CLI Module\n\nThe CLI entrypoint.\n" },
    { id: "engine", title: "Engine", content: "# Engine\n\nOrchestrates everything.\n" },
  ];
  const results = searchDocs(topics, "CLI");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, "cli");
  assert.ok(results[0]?.excerpts.length >= 1);
});

test("searchDocs returns empty for empty query", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.deepEqual(searchDocs(topics, ""), []);
  assert.deepEqual(searchDocs(topics, "   "), []);
});

test("searchDocs returns empty when no matches", () => {
  const topics = [{ id: "cli", title: "CLI", content: "# CLI\n" }];
  assert.deepEqual(searchDocs(topics, "zzzznonexistent"), []);
});

test("searchDocs avoids overlapping excerpts and caps at 4", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `Line ${i} contains keyword`);
  const topics = [{ id: "test", title: "Test", content: lines.join("\n") }];
  const results = searchDocs(topics, "keyword");
  assert.equal(results.length, 1);
  // Title "Test" does not match "keyword", so only body excerpts; capped at 4
  assert.equal(results[0]?.excerpts.length, 4);
});

test("searchDocs matches by topic id when title does not match", () => {
  const topics = [
    { id: "cli-module", title: "Command Line Interface", content: "# Command Line Interface\nBody text.\n" },
  ];
  const results = searchDocs(topics, "cli-module");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, "cli-module");
});

test("searchDocs returns multiple topics when query matches several", () => {
  const topics = [
    { id: "cli", title: "CLI", content: "# CLI\nUses the engine.\n" },
    { id: "engine", title: "Engine", content: "# Engine\nThe engine core.\n" },
  ];
  const results = searchDocs(topics, "engine");
  assert.equal(results.length, 2);
});

// ---------------------------------------------------------------------------
// handleDocs (handler integration)
// ---------------------------------------------------------------------------

test("handleDocs list mode returns topics with ids and titles", async () => {
  await withDocsFixture(
    {
      "toolkit.cli.md": "# CLI Module\n\nThe CLI entrypoint.\n",
      "architecture.md": "# Architecture\n\nOverview.\n",
    },
    async (docsDir) => {
      const output = await handleDocs({ docsDir });
      assert.equal(output.family, "docs");
      assert.equal(output.command, "docs");
      assert.equal(output.ok, true);
      assert.equal(output.exitCode, 0);
      assert.equal(output.data.operation, "list");
      if (output.data.operation === "list") {
        assert.equal(output.data.topics.length, 2);
        assert.ok(output.data.topics.find((t) => t.id === "cli"));
      }
    },
  );
});

test("handleDocs show mode returns topic content", async () => {
  await withDocsFixture({ "toolkit.cli.md": "# CLI Module\n\nThe CLI entrypoint.\n" }, async (docsDir) => {
    const output = await handleDocs({ topic: "cli", docsDir });
    assert.equal(output.ok, true);
    assert.equal(output.exitCode, 0);
    assert.equal(output.data.operation, "show");
    if (output.data.operation === "show") {
      assert.equal(output.data.topic.id, "cli");
      assert.equal(output.data.topic.title, "CLI Module");
      assert.ok(output.data.topic.content.includes("CLI entrypoint"));
    }
  });
});

test("handleDocs returns DOCS_TOPIC_NOT_FOUND for unknown topic", async () => {
  await withDocsFixture({ "toolkit.cli.md": "# CLI\nBody.\n" }, async (docsDir) => {
    const output = await handleDocs({ topic: "nonexistent", docsDir });
    assert.equal(output.ok, false);
    assert.equal(output.exitCode, 1);
    assert.ok(output.diagnostics.some((d) => d.code === "DOCS_TOPIC_NOT_FOUND"));
    // Returns show operation with null topic
    assert.equal(output.data.operation, "show");
    if (output.data.operation === "show") {
      assert.equal(output.data.topic, null);
    }
  });
});

test("handleDocs search mode returns matching results", async () => {
  await withDocsFixture(
    {
      "toolkit.cli.md": "# CLI Module\n\nThe CLI entrypoint.\n",
      "toolkit.engine.md": "# Engine\n\nOrchestrates everything.\n",
    },
    async (docsDir) => {
      const output = await handleDocs({ search: "CLI", docsDir });
      assert.equal(output.ok, true);
      assert.equal(output.data.operation, "search");
      if (output.data.operation === "search") {
        assert.equal(output.data.query, "CLI");
        assert.ok(output.data.results.length >= 1);
      }
    },
  );
});

test("handleDocs returns DOCS_DIR_NOT_FOUND when docs dir is missing", async () => {
  const output = await handleDocs({ docsDir: "/nonexistent/docs" });
  assert.equal(output.ok, false);
  assert.equal(output.exitCode, 1);
  assert.ok(output.diagnostics.some((d) => d.code === "DOCS_DIR_NOT_FOUND"));
  assert.equal(output.data.operation, "list");
  if (output.data.operation === "list") {
    assert.equal(output.data.topics.length, 0);
  }
});

test("handleDocs forwards warning diagnostics in topic-not-found response", {
  skip: process.getuid?.() === 0 && "root bypasses file permissions",
}, async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "valid.md": "# Valid\n",
    "broken.md": "# Broken\n",
  });
  await fs.chmod(path.join(docsDir, "broken.md"), 0o000);
  try {
    const output = await handleDocs({ topic: "nonexistent", docsDir });
    assert.equal(output.ok, false);
    assert.ok(output.diagnostics.some((d) => d.code === "DOCS_FILE_UNREADABLE"));
    assert.ok(output.diagnostics.some((d) => d.code === "DOCS_TOPIC_NOT_FOUND"));
  } finally {
    await fs.chmod(path.join(docsDir, "broken.md"), 0o644);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("handleDocs passes warning diagnostics through on success", {
  skip: process.getuid?.() === 0 && "root bypasses file permissions",
}, async () => {
  const tmp = await mkTmpRepo();
  const docsDir = await createDocsFixture(tmp, {
    "valid.md": "# Valid\n",
    "broken.md": "# Broken\n",
  });
  await fs.chmod(path.join(docsDir, "broken.md"), 0o000);
  try {
    const output = await handleDocs({ docsDir });
    assert.equal(output.ok, true);
    assert.equal(output.diagnostics.length, 1);
    assert.equal(output.diagnostics[0]?.code, "DOCS_FILE_UNREADABLE");
  } finally {
    await fs.chmod(path.join(docsDir, "broken.md"), 0o644);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("handleDocs search takes precedence over topic when both provided", async () => {
  await withDocsFixture({ "toolkit.cli.md": "# CLI\nBody.\n" }, async (docsDir) => {
    const output = await handleDocs({ topic: "cli", search: "CLI", docsDir });
    assert.equal(output.data.operation, "search");
  });
});
