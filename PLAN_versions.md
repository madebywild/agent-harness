# CLI Schema Versioning and Migration Architecture (Current-Major Runtime, Explicit Migration)

## Summary
Implement a versioning subsystem for `.harness` state files so future schema/type/logic changes are safe, explicit, and maintainable.  
Current behavior is strict `version: 1` parsing with no migration path.  
Target behavior is:
1. Regular commands run only on current schema major.
2. `doctor` reports version health and upgrade blockers.
3. `migrate` performs controlled upgrades with backup + atomic writes.
4. Architecture is pluggable for future version hops without rewriting engine/repository logic.

## Decisions Locked
1. Migration mode: explicit command (`harness migrate`) before mutating workflows.
2. Runtime compatibility window: only current major for normal commands.
3. Upgrade UX: add `harness doctor` and `harness migrate`.
4. Metadata policy: schema-version only (no persisted CLI semver enforcement).
5. Safety policy: automatic backup snapshot plus atomic writes during migration.

## Current-State Findings (Grounded)
1. Schemas are hard-coded with `z.literal(1)` in `/Users/tom/Github/agent-harness/packages/manifest-schema/src/index.ts`.
2. `repository.ts` directly parses with those schemas and collapses all version issues into generic invalid diagnostics.
3. `engine.ts` has no version preflight/doctor/migrate.
4. CLI has no explicit version management commands in `/Users/tom/Github/agent-harness/packages/toolkit/src/cli.ts`.
5. Baseline tests pass (`21/21`) in `packages/toolkit`.

## Public API / Interface Changes
1. Add `HarnessEngine` methods:
   - `doctor(options?: { json?: boolean }) => Promise<DoctorResult>`
   - `migrate(options?: { to?: "latest"; dryRun?: boolean; json?: boolean }) => Promise<MigrationResult>`
2. Add top-level exports in `/Users/tom/Github/agent-harness/packages/toolkit/src/index.ts`:
   - `doctor(opts?)`
   - `migrate(opts?)`
   - `DoctorResult`, `MigrationResult`, `VersionDiagnostic`, `MigrationAction`
3. Add CLI commands:
   - `harness doctor [--json]`
   - `harness migrate [--to latest] [--dry-run] [--json]`
4. Add CLI binary version output:
   - `harness -V|--version` wired to package version (informational only).

## Architecture and Implementation Plan

### 1) Introduce Versioning Core (Schema Package)
Files:
- `/Users/tom/Github/agent-harness/packages/manifest-schema/src/index.ts`
- `/Users/tom/Github/agent-harness/packages/manifest-schema/src/versioning.ts` (new)

Work:
1. Split schemas into explicit versioned names (`agentsManifestV1Schema`, etc.).
2. Add version detectors for each document kind (`manifest`, `lock`, `managed-index`, `provider-override`).
3. Add centralized constants:
   - `LATEST_SCHEMA_MAJOR = 1`
   - per-kind latest versions (currently all `1`)
4. Add utilities:
   - `detectDocumentVersion(kind, input)`
   - `isLatestVersion(kind, version)`
   - `class VersionError` with machine-readable reason (`unsupported_version`, `outdated_version`, `missing_version`, `invalid_version_type`).
5. Keep existing parse exports backward compatible (`parseManifest`, etc.) by routing through version-aware parsing and throwing `VersionError` when relevant.

### 2) Add Migration Registry (Toolkit)
Files:
- `/Users/tom/Github/agent-harness/packages/toolkit/src/versioning/registry.ts` (new)
- `/Users/tom/Github/agent-harness/packages/toolkit/src/versioning/doctor.ts` (new)
- `/Users/tom/Github/agent-harness/packages/toolkit/src/versioning/migrate.ts` (new)
- `/Users/tom/Github/agent-harness/packages/toolkit/src/types.ts`

Work:
1. Define `VersionStatus` model: `current | outdated | unsupported | invalid | missing`.
2. Define `DoctorResult` with per-file statuses and actionable diagnostics.
3. Define migration step interface:
   - `kind`, `fromVersion`, `toVersion`, `migrate(input)`.
4. Add registry lookup/chaining logic (future-proof for multi-hop upgrades).
5. For this rollout, registry is present but has no historical hops yet; command still handles `latest`/unsupported deterministically.

### 3) Repository Integration
File:
- `/Users/tom/Github/agent-harness/packages/toolkit/src/repository.ts`

Work:
1. Replace direct strict parse entrypoints with version-aware loaders.
2. Emit precise diagnostics:
   - `MANIFEST_VERSION_OUTDATED`
   - `MANIFEST_VERSION_UNSUPPORTED`
   - `LOCK_VERSION_OUTDATED`
   - `MANAGED_INDEX_VERSION_OUTDATED`
   - `OVERRIDE_VERSION_OUTDATED`
3. Keep existing invalid JSON/schema diagnostics distinct from version diagnostics.
4. Add structured return info so engine can distinguish “invalid data” vs “needs migration”.

### 4) Engine Preflight + New Commands
File:
- `/Users/tom/Github/agent-harness/packages/toolkit/src/engine.ts`

Work:
1. Add preflight `assertWorkspaceVersionCurrent()` for normal commands:
   - blocks `plan/apply/validate/watch/add/remove/provider enable/disable` when outdated/unsupported.
   - returns actionable hint: run `harness doctor` then `harness migrate`.
2. Implement `doctor()`:
   - scans manifest/lock/managed-index/override files.
   - prints status and whether migration is possible.
3. Implement `migrate()`:
   - supports `--dry-run`.
   - creates snapshot backup at `.harness/.backup/<timestamp>/...`.
   - writes migrated files via atomic temp-file + rename.
   - if lock/index cannot be migrated via chain, reset them to latest empty canonical structures (safe derived-state strategy).
   - does not regenerate provider outputs; user runs `harness apply` after migration.

### 5) CLI Wiring
File:
- `/Users/tom/Github/agent-harness/packages/toolkit/src/cli.ts`

Work:
1. Add `.version(...)`.
2. Add `doctor` command output (human + `--json`).
3. Add `migrate` command output (human + `--json`, `--dry-run`, `--to latest`).
4. Ensure exit codes:
   - `doctor`: `0` when fully current, `1` when issues exist.
   - `migrate`: `0` success/noop, `1` blocked/unsupported/invalid.
5. Keep existing default `plan` behavior, but preflight blocks non-current schema.

### 6) Atomic Write + Backup Utilities
Files:
- `/Users/tom/Github/agent-harness/packages/toolkit/src/utils.ts`
- `/Users/tom/Github/agent-harness/packages/toolkit/src/repository.ts`

Work:
1. Add `writeFileAtomic(absPath, content)`.
2. Add `copyToBackup(root, relPath, backupRoot)`.
3. Ensure backup path normalization and deterministic relative layout.
4. Ensure no interaction with source ownership scanner (backup is outside `.harness/src` patterns).

### 7) Documentation Updates
Files:
- `/Users/tom/Github/agent-harness/README.md`
- `/Users/tom/Github/agent-harness/docs/toolkit.cli.md`
- `/Users/tom/Github/agent-harness/docs/architecture.md`

Work:
1. Document version policy (current-major runtime, explicit migration).
2. Document `doctor` and `migrate` commands and backup behavior.
3. Document expected workflow during upgrades.

## Test Cases and Scenarios

### Unit/Integration Tests (Toolkit)
Files:
- `/Users/tom/Github/agent-harness/packages/toolkit/test/versioning.test.ts` (new)
- `/Users/tom/Github/agent-harness/packages/toolkit/test/workspace.test.ts` (extend)
- `/Users/tom/Github/agent-harness/packages/toolkit/test/path-schema.test.ts` (extend)

Cases:
1. `doctor` reports current workspace as healthy.
2. Manifest with unsupported version is reported as unsupported and blocks normal commands.
3. Outdated/unsupported override sidecar is surfaced with file path + provider context.
4. `migrate --dry-run` reports planned actions and writes nothing.
5. `migrate` writes backup snapshot before any modified file.
6. `migrate` uses atomic writes (no partial file content on forced interruption simulation).
7. `plan/apply/validate/watch` fail fast with migration hint on non-current schema.
8. `harness --version` prints package version.
9. Lock/index reset path after migration yields valid latest schemas.
10. No regression: existing 21 passing tests remain green.

## Acceptance Criteria
1. All normal CLI operations require current schema major and fail with clear migration instructions otherwise.
2. `doctor` gives deterministic machine-readable and human-readable status.
3. `migrate` is safe by default (backup + atomic), supports dry-run, and is idempotent on current workspaces.
4. Versioning logic is centralized and extensible (new version hop requires adding schema + migrator module, not editing core engine flow).
5. Existing behavior for current v1 workspaces remains unchanged except improved diagnostics and new commands.

## Assumptions and Defaults
1. “Only current major” applies to normal runtime commands; migration tooling remains the upgrade path.
2. No CLI self-update or network-based update checks are in scope.
3. Schema versions (not CLI semver metadata) are the source of truth for compatibility.
4. Lock/index are treated as derived artifacts and may be reset to latest canonical defaults during migration if no direct hop exists.
5. Backup retention is manual (no automatic pruning in this iteration).
