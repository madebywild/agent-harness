# `packages/toolkit/src/versioning/doctor.ts`

## Purpose

Performs workspace schema-version health checks and produces per-file version diagnostics.

## Main APIs

- `runDoctor(paths)`: scans required manifest, optional lock/managed-index, and discovered override sidecars.
- `hasVersionBlockers(doctorResult)`: returns `true` when any file is non-current.
- `buildVersionPreflightDiagnostics(doctorResult)`: converts doctor findings into command-preflight diagnostics.

## Behavior notes

- Status model: `current | outdated | unsupported | invalid | missing`.
- `DoctorResult.healthy` is `true` only when at least one file was inspected and no diagnostics were produced.
- `DoctorResult.migrationNeeded` is `true` when at least one file is `outdated`.
- `DoctorResult.migrationPossible` is `false` when any file is `unsupported`, `invalid`, or `missing`.
- Unsupported/newer schema files emit `*_VERSION_NEWER_THAN_CLI` with CLI-upgrade hints.
- Mixed-version states (at least one `outdated` plus at least one `current`) emit `MIGRATION_INCOMPLETE` guidance.
