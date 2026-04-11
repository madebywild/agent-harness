# `packages/toolkit/src/docs.ts`

## Purpose

Provides runtime documentation loading and search for the `harness docs` CLI command. Reads markdown files from the repository `docs/` directory, normalizes topic IDs, and supports full-text search with contextual excerpts.

## Topic ID normalization

Filenames are mapped to topic IDs by:

1. Stripping the `.md` extension
2. Replacing `/` with `.` (subdirectories become dot-separated segments)
3. Stripping the `toolkit.` prefix when present

Examples:

| File | Topic ID |
|---|---|
| `toolkit.cli.md` | `cli` |
| `toolkit.provider.claude.md` | `provider.claude` |
| `hook-authoring.md` | `hook-authoring` |
| `architecture/versioning.md` | `architecture.versioning` |

## Exported functions

- `resolveDocsDir()` — resolves the `docs/` directory path relative to the module location using `import.meta.url`.
- `loadDocTopics(docsDir)` — recursively reads all `.md` files, extracts titles from `# heading`, returns `DocTopic[]` and diagnostics.
- `findTopic(topics, query)` — looks up a single topic by exact ID match or `toolkit.`-prefixed form. Case-insensitive.
- `searchDocs(topics, query)` — case-insensitive substring search across topic titles, IDs, and body content. Returns excerpts with surrounding context lines. Deduplicates overlapping windows. Returns empty for blank queries.

## Sync guarantee

Documentation content is read from the filesystem at runtime — there is no pre-built index or cache. This means `harness docs` always reflects the current state of the `docs/` directory.

## CLI integration

The handler (`cli/handlers/docs.ts`) does not require `HarnessEngine` or a workspace. It is a self-contained read-only command with three operations:

- **list** (no arguments): returns all topic IDs and titles
- **show** (positional `[topic]`): returns full content of a matched topic
- **search** (`--search <query>`): returns matching topics with excerpts
