# npm Release Workflow

This repository publishes `@madebywild/agent-harness-manifest` and `@madebywild/agent-harness-framework` from a single tag-triggered GitHub Actions workflow.

## Trigger Model

- Workflow: `.github/workflows/publish-npm.yml`
- Trigger: `push` on tags matching `v*`
- Publish does not run on branch pushes.

## Release Steps

1. Bump versions in lockstep.
   - Update `version` in:
     - `packages/manifest-schema/package.json`
     - `packages/toolkit/package.json`
   - Both must be identical (`X.Y.Z`).
2. Commit the version bump on the branch that will land in `main`.
3. Ensure the release commit is in `main` (or your release base branch).
4. Create and push the release tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. Monitor workflow execution:

```bash
gh run list --workflow publish-npm.yml --limit 10
gh run watch <run-id> --exit-status
```

6. Verify npm publication:

```bash
npm view @madebywild/agent-harness-manifest dist-tags --json
npm view @madebywild/agent-harness-framework dist-tags --json
```

## Release Guard Scripts

The publish workflow runs these scripts from `package.json`:

- `pnpm run release:guard` (`prepublish`)
- `pnpm run release:publish` (`publish`)
- `pnpm run release:verify-published` (`verify-published`)

Implemented in `scripts/release/release-guard.mjs`.

Key checks:

- Package names and versions are valid.
- Both publishable packages share one version.
- `GITHUB_REF_NAME` tag matches package version.
- Existing npm versions are skipped (idempotent publish).
- Published version visibility is retried to handle npm propagation delay.

## Common Failure Modes

1. Tag not pushed to remote.
   - Symptom: no `publish-npm.yml` run appears.
   - Fix: push the missing tag (`git push origin vX.Y.Z`).
2. Tag/version mismatch.
   - Symptom: release guard fails with mismatch error.
   - Fix: align tag and package versions.
3. npm auth failure.
   - Symptom: `E401`/`E403` during `npm view` or `pnpm publish`.
   - Fix: verify `NPM_TOKEN` secret and npm publish permissions.
4. npm propagation delay.
   - Symptom: publish succeeded but verify step cannot see package yet.
   - Fix: rely on built-in retry or re-run verify.
