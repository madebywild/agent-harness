# Manifest Lock v1 Decision Checklist (Resolved)

This checklist resolves pre-implementation ambiguities for `agent-harness.lock.json` and defines the default behavior to implement in v1.

## Scope
- Applies to lockfile generation, drift detection, deterministic IDs, ownership/pruning, and merge semantics.
- Applies to `plan`, `apply`, `apply --prune`, `apply --strict`, and `apply --dry-run` behavior.

## Resolved Decisions

1. Lock write policy (`apply` no-op)
- Decision: If computed semantic state is unchanged, do not rewrite the lockfile at all.
- Rationale: preserves byte identity, including `generatedAt` and `generatedBy`.
- Implementation rule: compare computed lock payload fingerprint with on-disk `stateFingerprint` before write.

2. Manual lock edit detection
- Decision: add `stateFingerprint` to lockfile.
- Fingerprint input: canonical lock JSON excluding `stateFingerprint` itself.
- Behavior: mismatch emits warning by default, becomes error under `--strict`.

3. `generatedAt` and `generatedBy` update semantics
- Decision: update both fields only when semantic state changes.
- No-op apply: keep existing values unchanged, even on different machine/runtime.

4. Deterministic ID derivation
- Decision: ID algorithms are fixed in v1.
- `artifactId`: normalized POSIX relative artifact path.
- `bindingId`: `sha256(resourceId + "\0" + vendor + "\0" + processorId).slice(0, 24)`.
- `fragmentId`: `sha256(bindingId + "\0" + artifactPath + "\0" + fragmentKey).slice(0, 24)`.
- Hash output format: lowercase hex.

5. Ownership data required for prune precision
- Decision: each artifact contributor must store both `resourceId` and `specimenDigestSha256`.
- Prune rule: remove only contributors/fragments whose `(resourceId, specimenDigestSha256)` are absent from desired lock state.

6. `json_object_merge` conflict semantics
- Decision: deep object merge only for plain objects.
- Primitive/array/null collisions:
  - equal values: allowed (idempotent)
  - different values: conflict (error in v1)
- Arrays are not merged element-wise in v1.

7. Managed section marker safety
- Decision: constrain key character set used in markers.
- `resource.id` and `fragmentKey` allowed pattern: `[A-Za-z0-9._-]+`.
- `ownerKey`: `<resourceId>::<fragmentKey>`.
- `sectionKey`: lowercase hex length `16` from `sha256(artifactId + "\0" + ownerKey).slice(0, 16)`.

8. Prune precedence
- Decision: effective prune mode is `CLI flag` if provided, else `policy.pruneDefault`.
- `--dry-run` never performs deletions, but still reports planned prune operations.

9. Path normalization and base directory
- Decision: normalize all stored lock paths to POSIX relative paths from effective `--cwd` (or process cwd).
- Disallow absolute paths and parent traversal (`..`) in lock path fields.

10. Schema strictness boundary
- Decision: lock structural schema is strict in v1 (`additionalProperties: false`) for top-level records.
- Resource `specimen` remains partially extensible for per-kind metadata and processor-neutral evolution.

## Implementation Checklist
- [ ] Add `stateFingerprint` computation and validation in lock read/write path.
- [ ] Implement fixed ID derivation helpers (`bindingId`, `fragmentId`).
- [ ] Enforce contributor ownership fields (`resourceId`, `specimenDigestSha256`).
- [ ] Implement strict `json_object_merge` collision behavior.
- [ ] Enforce path normalization relative to effective cwd.
- [ ] Apply prune precedence and dry-run reporting rules.
- [ ] Add schema tests for required fields, enums, conditionals, and status transitions.

## Review Gates Before Coding Processors
- [ ] Verify lock schema validates canonical fixtures for each vendor.
- [ ] Verify no-op apply keeps lock bytes unchanged across repeated runs.
- [ ] Verify lock drift warning/error behavior with manual file edits.
- [ ] Verify prune deletes only removed contributor ownership tuples.
