# `packages/toolkit/src/utils.ts`

## Purpose

Low-level shared helpers for hashing, path normalization, deterministic JSON formatting, file existence checks, and small string/collection utilities.

## Key APIs

- Hashing: `sha256(value)`
- Path normalization: `normalizeRelativePath(input)`, `toPosixRelative(fromAbs, rootAbs)`
- Deterministic serialization: `stableStringify(value)`
- File helpers: `readTextIfExists`, `exists`, `ensureParentDir`, `isNotFoundError`
- Structural comparison: `deepEqual(left, right)`
- Collection/time/string helpers: `uniqSorted`, `nowIso`, `stripTrailingNewlines`, `withSingleTrailingNewline`

## Contract details

- `normalizeRelativePath` enforces relative POSIX paths and rejects parent traversal.
- `stableStringify` sorts object keys recursively and appends exactly one trailing newline.
- `deepEqual` compares recursively key-sorted JSON representations.
