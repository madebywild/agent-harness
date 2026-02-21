# Spec Review: CLI Schema Versioning and Migration Architecture

**Reviewer:** Claude · **Date:** 2026-02-20
**Document under review:** CLI Schema Versioning and Migration Architecture (Current-Major Runtime, Explicit Migration)

---

## Executive Summary

This is a well-structured specification that gets the fundamentals right. The "current-major runtime, explicit migration" model is a proven pattern used by Terraform, Prisma, and Helm — tools that manage local state files in production contexts. The spec demonstrates clear understanding of the problem space and makes defensible architectural choices.

That said, several areas would benefit from tightening before implementation. The most significant gaps are around **rollback strategy**, **multi-file atomicity guarantees**, **version detection for corrupted files**, and **the lock/index reset semantics** during migration. Below is a detailed analysis organized by theme, with industry comparisons throughout.

---

## What the Spec Gets Right

### 1. Explicit Migration Over Auto-Upgrade

The decision to require `harness migrate` rather than auto-upgrading on any command is the correct call for a CLI that manages infrastructure-like state. This mirrors Terraform's approach — `terraform init` does not silently upgrade state file formats. Prisma takes the same stance: `prisma migrate deploy` is a separate, intentional step.

Auto-upgrade (the Docker Compose approach, where version is now "informational only" and the latest schema always applies) works for stateless config files but is dangerous for stateful systems where a failed upgrade could corrupt derived outputs. The harness-CLI manages manifests, locks, and generated provider files — auto-upgrade would risk partial writes that leave the workspace in an inconsistent state.

### 2. Doctor + Migrate as Separate Commands

Splitting diagnosis from action is a pattern validated by multiple tools. Prisma has `prisma migrate status` (diagnosis) vs `prisma migrate deploy` (action). Helm has `helm lint` (diagnosis) vs the actual install/upgrade. Kubernetes has `kubectl api-versions` and third-party tools like `kubent` for detecting deprecated APIs before you act.

Having `harness doctor` return machine-readable output (`--json`) with deterministic exit codes is especially useful for CI/CD pipelines. This is something Prisma got wrong initially — `prisma migrate status` returned exit code 0 even on errors until v4.3.0.

### 3. Backup + Atomic Writes

The backup-before-migrate policy is sound. Helm's v2→v3 migration plugin documents backup as "critical" and warns that migration is not reversible without it. Terraform doesn't auto-backup state during format upgrades, which has been a source of production incidents.

### 4. Schema Version as Source of Truth (Not CLI Semver)

Decoupling the schema version from the CLI's package version is the right call. Terraform makes the same distinction: its state file has a `version` field (integer, currently 4) independent of the Terraform binary's semver. Kubernetes uses `apiVersion` strings (e.g., `apps/v1`) that are entirely decoupled from the cluster version. Docker Compose's version field was tied to the tooling version and ultimately had to be deprecated because the coupling created confusion.

---

## Areas That Need Strengthening

### 1. Rollback Strategy Is Underspecified

**The gap:** The spec describes creating backups at `.harness/.backup/<timestamp>/` but says nothing about how to restore from them. There is no `harness migrate --rollback` or `harness restore` command.

**Industry comparison:** Prisma provides `prisma migrate resolve --rolled-back <migration>` to record that a migration was rolled back. Helm's `helm rollback` is a first-class command. Terraform's state can be restored by copying the backup file back manually, but this is widely considered a pain point.

**Recommendation:** At minimum, document the manual restore procedure (copy files back from `.harness/.backup/<timestamp>/`). Ideally, add a `harness migrate --restore <timestamp>` command, or at least have `harness doctor` detect backup directories and suggest restore steps when the current state is broken.

### 2. Multi-File Atomicity Is Not Actually Atomic

**The gap:** The spec mentions "atomic writes" (temp-file + rename), which provides per-file atomicity. But a migration touches four file types (manifest, lock, managed-index, provider overrides). If the process crashes after writing the manifest but before writing the lock, the workspace is in an inconsistent state.

**Industry comparison:** Terraform solves this by having a single state file. Prisma uses a database transaction for its migration table. SQLite uses write-ahead logging.

**Recommendation:** Since you're dealing with multiple JSON/YAML files on a filesystem (no transactional store), consider one of these approaches:

- **Write-then-commit pattern:** Write all migrated files to a staging directory (e.g., `.harness/.migration-staging/`), then rename-swap them into place in sequence. If any write fails, the staging directory is discarded.
- **Migration journal:** Write a `.harness/.migration-journal.json` before starting that records the planned operations. On next startup, `doctor` checks for an incomplete journal and either completes or rolls back the migration. This is essentially a write-ahead log.
- **Accept the gap explicitly:** Document that if migration is interrupted, `harness doctor` will detect the inconsistency and `harness migrate` should be re-run (idempotent). This is the simplest approach and may be sufficient for v1.

### 3. Version Detection for Malformed Files

**The gap:** The spec defines `detectDocumentVersion(kind, input)` but doesn't specify behavior when the `version` field is present but the rest of the document is malformed JSON/YAML, or when the version field itself is a non-integer type (string `"1"`, float `1.0`, null, etc.).

**Industry comparison:** Kubernetes is strict — `apiVersion` must be an exact string match. Terraform's state parser rejects unknown version numbers with a clear error message that names the expected version.

**Recommendation:** Define explicit behavior for these edge cases in `VersionError`:

- `version` field missing entirely → `missing_version`
- `version` field is wrong type (string, float, null, array) → `invalid_version_type`
- `version` field is a valid integer but unknown → `unsupported_version`
- File is not valid JSON/YAML → this should remain a parse error, *not* a version error (keep the diagnostic categories distinct, as the spec already intends)

The spec mentions `invalid_version_type` as a reason — good. Just ensure the detection logic runs *before* full schema validation so users get "your manifest is version 2, which this CLI doesn't support yet" rather than "your manifest is invalid" with a wall of Zod errors.

### 4. Lock/Index Reset Semantics Need More Detail

**The gap:** Section 4 says "if lock/index cannot be migrated via chain, reset them to latest empty canonical structures (safe derived-state strategy)." This is reasonable since lock and managed-index are derived artifacts, but the implications aren't spelled out.

**What happens after reset:**
- The managed-index loses track of which output files are managed. The next `harness apply` will see existing provider output files (CLAUDE.md, .mcp.json, etc.) as unmanaged and flag `OUTPUT_COLLISION_UNMANAGED` errors.
- The lock loses all content hashes. The next `harness apply` will regenerate everything, even if nothing actually changed.

**Recommendation:** Either:
- Have the migration process *also* run a regeneration step (equivalent to `harness apply`) after resetting derived state, so the workspace is consistent immediately.
- Or explicitly document that after migration, `harness apply` is required and may flag collisions that the user needs to resolve. The spec does mention "user runs `harness apply` after migration" but doesn't address the collision scenario.
- Consider a `harness apply --force` or `harness apply --adopt` flag that re-claims ownership of files matching the expected output paths.

### 5. No Forward-Compatibility Story

**The gap:** The spec handles outdated versions well but doesn't address what happens when a *newer* CLI opens a workspace created by an *older* CLI at the *same* major version. For example: CLI v1.5 adds an optional `metadata` field to the manifest; CLI v1.3 opens that workspace and silently strips `metadata` because Zod's strict mode rejects unknown keys.

**Industry comparison:** Kubernetes explicitly handles this through its storage version mechanism — objects stored at a newer version include fields that older API servers may not understand, and there are clear rules about field preservation. Protocol Buffers preserve unknown fields by default. Terraform's state includes a `terraform_version` field specifically so that the CLI can warn "this state was written by a newer version."

**Recommendation:** Two options:

- **Add a `toolVersion` or `generatedBy` metadata field** to state files (informational, not enforced). When the CLI sees a `toolVersion` newer than itself, it can warn "this workspace was last modified by harness-cli 1.5.0; you're running 1.3.0 — some features may not be available."
- **Use `.passthrough()` instead of `.strict()` on Zod schemas** so that unknown fields survive round-trips without data loss. This is the more robust approach but changes the current validation behavior.

At minimum, this deserves a "Decision" entry in the spec about whether minor-version field additions within a major version are expected to be backward-compatible or whether they require a major bump.

### 6. The "Only Current Major" Rule Needs a Minor-Version Story

**The gap:** The spec says "only current major for normal commands" but all schemas are currently at version 1. What happens when you need to add an optional field to the manifest schema without bumping to version 2? Is version 1.1 a thing? Or does every schema change require a major version bump?

**Industry comparison:**
- Kubernetes uses `v1`, `v1beta1`, `v2alpha1` — a rich versioning within API groups.
- Terraform's state version is a simple integer (currently 4) and every format change bumps it.
- Docker Compose tried `2.0`, `2.1`, `2.2`, `3.0`, `3.1`... and the resulting complexity was a key reason they eventually deprecated the version field entirely.

**Recommendation:** The simplest approach is to follow Terraform: keep it as integers, bump on any breaking change, and use Zod schema permissiveness (optional fields, `.passthrough()`) for non-breaking additions within a version. Document this policy explicitly: "Version N+1 is required only for breaking changes. Additive, optional fields may be introduced within version N."

### 7. Per-Kind Versioning Creates Combinatorial Complexity

**The gap:** The spec defines `LATEST_SCHEMA_MAJOR = 1` globally but also "per-kind latest versions (currently all 1)." This means in the future, the manifest could be at version 3 while the lock is at version 2 and overrides are at version 1. The migration system needs to handle each kind independently.

**Industry comparison:** Terraform avoids this by having a single state file with one version. Kubernetes has per-resource API versions but a massive infrastructure (API server, conversion webhooks, storage migration controllers) to manage it. Prisma versions migrations sequentially, not per-table.

**Recommendation:** Consider whether per-kind versioning is actually needed. If schema changes tend to be correlated (e.g., adding a new entity type affects manifest, lock, and index simultaneously), a single workspace version number is simpler and eliminates the combinatorial explosion. If you do keep per-kind versions, the migration registry needs to handle version tuples, not scalar versions — and `doctor` needs to report the version of each file independently.

### 8. Missing: CI/CD and Non-Interactive Usage Patterns

**The gap:** The spec focuses on interactive developer usage (run `doctor`, see output, run `migrate`). Production CI/CD pipelines need to handle version mismatches programmatically.

**Recommendation:** Add explicit guidance for CI/CD:
- `harness doctor --json` with exit code 1 → CI fails with clear message
- `harness migrate --json` for scripted migration in CI
- Consider a `--no-interactive` or `--ci` flag that turns migration into a hard failure with instructions rather than a prompt

The `--json` flags already cover most of this — just document the intended CI/CD workflow.

### 9. Backup Retention Policy

**The gap:** The spec says "backup retention is manual (no automatic pruning in this iteration)" in Assumptions. This is fine for v1, but without pruning, `.harness/.backup/` will accumulate indefinitely. Each backup contains a full copy of all state files.

**Recommendation:** Either add `.harness/.backup/` to the managed-index's awareness (so it doesn't flag backup files as unmanaged candidates), or explicitly exclude the backup directory from source scanning. The current `collectSourceCandidates()` function uses regex patterns on `.harness/src/` so it may already be excluded — but this should be verified and documented.

### 10. Missing: Concurrent Migration Safety

**The gap:** The spec doesn't address what happens if two processes run `harness migrate` simultaneously (e.g., in a monorepo with parallel CI jobs).

**Recommendation:** Consider a lockfile mechanism (e.g., `.harness/.migration-lock`) to prevent concurrent migrations. This is a common pattern in package managers (npm's `package-lock.json` write locking, yarn's lock).

---

## Minor Issues and Suggestions

1. **Exit code semantics:** The spec says `migrate` returns exit code 1 for "blocked/unsupported/invalid." Consider distinguishing between "nothing to do" (exit 0), "migration succeeded" (exit 0), "migration failed" (exit 1), and "migration blocked due to unsupported version" (exit 2). This helps CI scripting.

2. **Dry-run fidelity:** `migrate --dry-run` should report exactly what backup files would be created and what files would be written. Prisma's `migrate dev --create-only` is a good model — it creates the migration file but doesn't apply it.

3. **Version in error messages:** When a command fails due to version mismatch, include both the found version and the expected version in the error message. Terraform does this well: "state snapshot was created by Terraform v1.7.5, which is newer than current v0.12.29."

4. **Test case gap — downgrade attempt:** Add a test for what happens when someone tries to open a v2 workspace with a v1-only CLI. The spec covers "unsupported" but a dedicated test ensures the error message is clear and doesn't leak Zod internals.

5. **Override sidecar versioning:** Provider override files (YAML) are versioned independently. Ensure that `doctor` reports override versions per-file, not aggregated. A workspace could have some overrides at v1 and others at v2 after a partial manual edit.

---

## Comparison Matrix

| Aspect | Your Spec | Terraform | Prisma | Kubernetes | Helm |
|---|---|---|---|---|---|
| Version scheme | Integer per kind | Single integer | Timestamp sequence | String (group/version) | `v1`/`v2` in Chart.yaml |
| Migration trigger | Explicit command | `init -migrate-state` | `migrate deploy` | Storage version migrator | `helm 2to3` plugin |
| Backup policy | Auto before migrate | Manual | Manual | N/A (etcd) | Critical, via plugin |
| Rollback support | **Not specified** | Manual file copy | `migrate resolve` | Inherent (multi-version) | `helm rollback` |
| Diagnostic command | `doctor` | No dedicated command | `migrate status` | `kubent` (third-party) | `helm lint` |
| Derived state handling | Reset to empty | Single file (no split) | DB is authority | etcd storage migration | Re-render templates |
| Forward compat | **Not addressed** | `terraform_version` field | N/A | Field preservation | v1 charts work in v3 |
| Atomicity | Per-file only | Single file | DB transaction | etcd transaction | Single release object |
| CI/CD support | `--json` flags | Native | `--json` flag (limited) | kubectl flags | `--dry-run` flag |

---

## Verdict

The spec is **production-viable** with the clarifications above. The core architecture — explicit migration, doctor diagnostics, backup-before-write, pluggable migration registry — follows industry best practices. The strongest aspects are the clear separation of concerns (schema package → toolkit → CLI) and the decision to keep schema version decoupled from CLI semver.

The three highest-priority items to address before implementation are:

1. **Define the forward-compatibility story** (what happens with newer workspaces on older CLIs) — this will cause real pain if not decided upfront.
2. **Clarify multi-file atomicity** — even if the answer is "accept the gap and make `migrate` idempotent," it should be an explicit decision.
3. **Spell out the post-migration workflow** for lock/index reset — particularly the unmanaged file collision scenario.

Everything else can be addressed iteratively as the system is used in practice.
