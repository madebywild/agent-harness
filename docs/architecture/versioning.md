# Schema Versioning Architecture

This document describes the versioning and migration architecture for Agent Harness workspace state files.

## Overview

Agent Harness uses a **"current-major runtime, explicit migration"** model. This means:

- Normal commands (plan, apply, watch) operate only on the current schema version
- Outdated or newer schema versions block writes until explicitly addressed
- Schema upgrades are performed via an intentional `harness migrate` command
- The CLI provides diagnostic tools (`harness doctor`) to detect version issues before they cause failures

This architecture is inspired by proven patterns in infrastructure-as-code tools like Terraform, Prisma, and Helm.

## Core Principles

### Explicit Migration Over Auto-Upgrade

The CLI **never** auto-upgrades schema versions during normal operations. This is an intentional safety measure:

- **Why**: Workspace state includes the manifest, lock file, managed-index, and provider overrides. An auto-upgrade that fails partway through could leave the workspace in an inconsistent state with partial writes.
- **Contrast**: Docker Compose uses auto-upgrade (version is "informational only"), which works for stateless config files but is dangerous for stateful systems.
- **Approach**: The user must explicitly run `harness migrate`, making the upgrade an intentional act with clear preconditions.

### Doctor and Migrate as Separate Commands

The architecture separates **diagnosis** from **action**:

- **`harness doctor`**: Scans workspace versioned files and reports their version status (current, outdated, unsupported, invalid, missing).
- **`harness migrate`**: Performs the actual migration after diagnostics confirm it's safe.

This pattern appears across the ecosystem:
- Prisma: `migrate status` (diagnosis) vs `migrate deploy` (action)
- Helm: `helm lint` (diagnosis) vs install/upgrade (action)
- Kubernetes: `kubent` and `kubectl api-versions` for detecting deprecated APIs before acting

### Backup Before Migration

Every migration creates a complete backup snapshot at `.harness/.backup/<timestamp>/` before writing any changes:

- **Why**: Migration is not reversible without a backup. If the migration introduces unexpected behavior, the user needs a recovery path.
- **Industry precedent**: Helm's v2→v3 migration plugin documents backup as "critical" and warns that migration is not reversible without it.

### Schema Version Is Independent of CLI Version

The schema version (e.g., `version: 1` in `manifest.json`) is entirely decoupled from the CLI's package version (e.g., `harness-cli@1.5.0`):

- **Why**: Coupling schema version to tool version creates confusion. Docker Compose's version field was tied to tooling version and had to be deprecated.
- **Precedent**: Terraform's state file has a `version` field (integer, currently 4) independent of the Terraform binary's semver. Kubernetes uses `apiVersion` strings decoupled from cluster version.
- **Benefit**: The CLI can have many releases (bug fixes, features) without bumping the schema version. Schema bumps happen only for breaking structural changes.

## Version States

Each workspace file can be in one of these states:

| State | Description |
|-------|-------------|
| `current` | File is at the schema version supported by this CLI |
| `outdated` | File is at an older version that can be migrated forward |
| `unsupported` | File is at a newer version than this CLI supports (forward compatibility block) |
| `invalid` | File has missing, malformed, or wrong-type version metadata |
| `missing` | Required file does not exist |

### Version Detection Edge Cases

The CLI handles these edge cases explicitly:

- **Missing version field**: Detected before schema validation; produces clear error rather than generic parse error
- **Wrong type version** (string `"1"`, float `1.0`, null): Explicit `invalid_version_type` error
- **Unknown integer version**: `unsupported_version` error with clear messaging
- **Malformed JSON/YAML**: Parse error (separate from version errors to preserve diagnostic clarity)

**Current implementation detail**: `manifest.json` is required and can report `missing`; `manifest.lock.json` and `managed-index.json` are optional for doctor/migration preflight and are omitted from doctor file status output when absent.

## Migration Mechanics

### Per-Kind Versioning

Each file type versions independently:

- `manifest.json`: Has its own schema version
- `manifest.lock.json`: Has its own schema version  
- `managed-index.json`: Has its own schema version
- Override sidecars: Each provider override file versions independently

This allows targeted changes without forcing a global version bump when only one file type changes structure.

### Migration Chain

Migrations are applied via a registry of transformation functions:

```
v1 → v2 → v3 → ... → current
```

- The system applies all transformations sequentially to bring outdated files to current
- Each transformation is pure (input vN → output vN+1)
- Migration is idempotent: running migrate on an already-current workspace is a no-op

### Derived State Handling

Lock files (`manifest.lock.json`) and managed-index (`managed-index.json`) are **derived state** — they can be recomputed from the manifest and source files. During migration:

- These files are reset to empty canonical structures if they cannot be migrated via chain
- After migration, the CLI rebuilds them from the desired rendered outputs
- This "reset and rebuild" strategy is safe because the data is derived, not authoritative

**Post-migration implications**: After a lock/index reset, the next `harness apply` regenerates all outputs. The managed-index adopts the expected output paths during migration to prevent unmanaged file collision errors.

### Write Order and Atomicity

Migration writes files in deterministic order:

1. Override sidecars
2. Lock file (`manifest.lock.json`)
3. Managed-index (`managed-index.json`)
4. Manifest (`manifest.json`) — **last**

**Atomicity guarantees**:

- Per-file atomicity: Each file is written via temp-file + rename
- No global transaction: If the process crashes after writing the lock but before the manifest, the workspace may be in a mixed-version state
- Recovery: `harness doctor` detects mixed-version states and reports `MIGRATION_INCOMPLETE`. Re-running `harness migrate` converges deterministically.

**Rationale**: Full multi-file atomicity would require a write-ahead log or staging directory pattern. For v1, the accepted trade-off is "accept the gap and make migration idempotent" — simpler to implement and sufficient because mixed states are detectable and recoverable.

## Forward Compatibility

### Older CLI, Newer Workspace

When an older CLI encounters a workspace with a newer schema version:

- **Reads**: Allowed (for diagnostics)
- **Writes**: Blocked with `*_VERSION_NEWER_THAN_CLI` error
- **Why**: Prevents the older CLI from silently stripping fields it doesn't understand, which would cause data loss

**Industry precedent**: Terraform includes a `terraform_version` field in state specifically to warn "this state was written by a newer version."

### Field Preservation Within Versions

Within a major version, additive changes (new optional fields) do not bump the schema version. The CLI uses Zod schema permissiveness (optional fields, `.passthrough()`) for non-breaking additions.

Version N+1 is required **only for breaking changes** (structural renames, required field additions, type changes).

## CI/CD Integration

The versioning system supports non-interactive usage:

- `harness doctor --json`: Machine-readable output with deterministic exit codes
- `harness migrate --json`: Scripted migration with structured output
- Exit codes: 
  - `0`: Success / healthy workspace
  - `1`: Non-healthy doctor result or migration failure

**Recommended CI workflow**:

```bash
# Apply any needed migrations first (no-op when already current)
npx harness migrate --json || exit 1

# Optionally assert healthy post-migration state
npx harness doctor --json || exit 1

# Normal operation
npx harness apply
```

## Industry Comparison

| Aspect | Agent Harness | Terraform | Prisma | Kubernetes | Helm |
|--------|---------------|-----------|--------|------------|------|
| Version scheme | Integer per kind | Single integer | Timestamp sequence | String (group/version) | `v1`/`v2` in Chart.yaml |
| Migration trigger | Explicit command | `init -migrate-state` | `migrate deploy` | Storage version migrator | `helm 2to3` plugin |
| Backup policy | Auto before migrate | Manual | Manual | N/A (etcd) | Critical, via plugin |
| Rollback support | Manual from backup | Manual file copy | `migrate resolve` | Inherent (multi-version) | `helm rollback` |
| Diagnostic command | `doctor` | No dedicated command | `migrate status` | `kubent` (third-party) | `helm lint` |
| Derived state handling | Reset + rebuild | Single file (no split) | DB is authority | etcd storage migration | Re-render templates |
| Forward compat | Block writes | `terraform_version` field | N/A | Field preservation | v1 charts work in v3 |
| Atomicity | Per-file + idempotent | Single file | DB transaction | etcd transaction | Single release object |

## Design Trade-offs

### Per-File vs. Global Atomicity

**Decision**: Accept per-file atomicity with idempotent re-run rather than implementing a global transaction.

**Rationale**: 
- Filesystem-based state (multiple JSON/YAML files) lacks native transactions
- A staging directory or write-ahead log adds complexity
- Mixed-version states are detectable via `doctor` and recoverable via re-running `migrate`
- This matches the "accept the gap explicitly" approach

### Per-Kind vs. Single Workspace Version

**Decision**: Each file type versions independently.

**Rationale**:
- Allows targeted schema evolution
- Prevents unnecessary version bumps when only one file type changes
- Trade-off: Combinatorial complexity in theory, but in practice schema changes tend to be correlated

### Integer vs. Semver for Schema Version

**Decision**: Simple integer versioning (1, 2, 3) rather than semver (1.0, 1.1, 2.0).

**Rationale**:
- Follows Terraform's proven model
- Simpler mental model: version N+1 is a breaking change
- Additive fields handled via schema permissiveness, not version bumps
- Avoids Docker Compose's complexity with 2.0, 2.1, 2.2, 3.0, 3.1...

## Security and Safety Considerations

1. **Backup retention**: Backup directories accumulate indefinitely (manual pruning). They are excluded from source scanning to prevent unmanaged file collisions.

2. **Concurrent migration**: Running `harness migrate` simultaneously from two processes could cause conflicts. In CI environments with parallel jobs, ensure serialization or use workspace locking at the CI level.

3. **Downgrade prevention**: The CLI explicitly rejects downgrade attempts (`MIGRATION_DOWNGRADE_UNSUPPORTED`). Once migrated forward, restoration requires manual backup copy.
