# `packages/toolkit/src/docs.ts`

## Purpose

Provides runtime documentation loading and search for the `harness docs` CLI command. Reads markdown files from the repository `docs/` directory, normalizes topic IDs, and supports full-text search with contextual excerpts.

## Topic ID normalization

Filenames are mapped to topic IDs by:

1. Stripping the `.md` extension
2. Replacing `/` with `.` (subdirectories become dot-separated segments)
3. Stripping the `toolkit.` prefix when present
4. Skipping files that produce empty IDs (e.g. `.md`)

Examples:

| File | Topic ID |
|---|---|
| `toolkit.cli.md` | `cli` |
| `toolkit.provider.claude.md` | `provider.claude` |
| `hook-authoring.md` | `hook-authoring` |
| `architecture/versioning.md` | `architecture.versioning` |
| `toolkit.md` | `toolkit` |

## Exported types

- `DocTopic` — `{ id: string; title: string; content: string }` — a loaded documentation topic with full content.
- `DocTopicSummary` — `{ id: string; title: string }` — a topic without content, used in listing output.
- `DocsSearchResult` — `{ id: string; title: string; excerpts: string[] }` — a search hit with up to 4 contextual excerpts. Excerpt strings may contain embedded newlines representing context lines around the match.

## Exported functions

- `resolveDocsDir()` — resolves the `docs/` directory path relative to the module location using `import.meta.url`. Performs no I/O; directory existence is validated by `loadDocTopics`.
- `loadDocTopics(docsDir)` — recursively reads all `.md` files, extracts titles from `# heading`, returns `DocTopic[]` and diagnostics. Skips symlinks and limits traversal depth to 10 levels. Unreadable files emit a `DOCS_FILE_UNREADABLE` warning diagnostic instead of failing the entire load.
- `findTopic(topics, query)` — looks up a single topic by exact ID match or `toolkit.`-prefixed form. Fully case-insensitive; trims whitespace from the query.
- `searchDocs(topics, query)` — case-insensitive substring search across topic titles, IDs, and body content. Returns up to 4 excerpts per topic with surrounding context lines. Returns empty for blank queries.
- `toTopicSummaries(topics)` — projects `DocTopic[]` to `DocTopicSummary[]` (strips content).
- `fileToTopicId(relativePath)` — converts a file path to a topic ID. Exported for testing.

## Sync guarantee

Documentation content is read from the filesystem at runtime — there is no pre-built index or cache. This means `harness docs` always reflects the current state of the `docs/` directory.

## Security

- Symlinks are skipped during directory traversal to prevent reading files outside the docs directory.
- Resolved file paths are validated to stay under the docs directory (defense-in-depth containment check).
- Directory traversal depth is capped at 10 levels to prevent stack overflow from deeply nested structures.

## CLI integration

The handler (`cli/handlers/docs.ts`) does not require `HarnessEngine` or a workspace. It is a self-contained read-only command with three operations:

- **list** (no arguments): returns all topic IDs and titles.
- **show** (positional `[topic]`): returns full content of a matched topic. Returns `null` topic with `DOCS_TOPIC_NOT_FOUND` diagnostic on failure.
- **search** (`--search <query>`): returns matching topics with excerpts. When both `<topic>` and `--search` are provided, `--search` takes precedence.

## Error codes

| Code | Severity | Condition |
|---|---|---|
| `DOCS_DIR_NOT_FOUND` | error | The docs directory does not exist or is unreadable |
| `DOCS_FILE_UNREADABLE` | warning | A specific markdown file could not be read (permission, encoding) |
| `DOCS_TOPIC_NOT_FOUND` | error | The requested topic ID does not match any loaded topic |
