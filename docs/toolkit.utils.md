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

- `normalizeRelativePath` enforces relative POSIX paths and rejects:
  - absolute paths,
  - Windows drive-prefixed paths (for example `C:/...` or `C:...`),
  - any raw `..` segment (even if normalization would remove it),
  - normalized `"."` / `".."` results (including root-collapsing aliases like `""`, `"."`, `"a/.."`).
- `stableStringify` sorts object keys recursively and appends exactly one trailing newline.
- `deepEqual` compares recursively key-sorted JSON representations.
