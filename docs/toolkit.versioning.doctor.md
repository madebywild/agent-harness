# `packages/toolkit/src/versioning/doctor.ts`

## Purpose

Performs workspace schema-version health checks and produces per-file version diagnostics.

## Main APIs

- `runDoctor(paths)`: scans manifest, lock, managed-index, and discovered override sidecars.
- `hasVersionBlockers(doctorResult)`: returns `true` when any file is non-current.
- `buildVersionPreflightDiagnostics(doctorResult)`: converts doctor findings into command-preflight diagnostics.

## Behavior notes

- Status model: `current | outdated | unsupported | invalid | missing`.
- Unsupported/newer schema files emit `*_VERSION_NEWER_THAN_CLI` with CLI-upgrade hints.
- Mixed current/outdated states emit `MIGRATION_INCOMPLETE` guidance.
