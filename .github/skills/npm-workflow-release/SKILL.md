---
name: npm-workflow-release
description: Release agent-harness packages to npm and verify publication. Use when the user asks to cut a release, push a missing release tag, or troubleshoot why a version was not published.
---

# npm-workflow-release

Run the release workflow for this repository end-to-end.

Use `$ARGUMENTS` as the target version when provided (for example: `1.6.0` or `v1.6.0`).

## Steps

1. Resolve the target version.
   - If `$ARGUMENTS` is provided, normalize it to `X.Y.Z` and `vX.Y.Z`.
   - If not provided, infer the intended version from context and confirm package files match.
2. Validate lockstep package versions.
   - Check `packages/manifest-schema/package.json` and `packages/toolkit/package.json`.
   - Ensure both `version` values are identical and equal to the target version.
3. Confirm release workflow prerequisites.
   - Check `.github/workflows/publish-npm.yml` triggers on tag push (`v*`).
   - Run `GITHUB_REF_NAME=vX.Y.Z pnpm run release:guard` before publishing.
4. Ensure the release tag exists remotely.
   - Check local and remote tags for `vX.Y.Z`.
   - If missing on remote, push it: `git push origin vX.Y.Z`.
5. Monitor the publish run in GitHub Actions.
   - Use `gh run list --workflow publish-npm.yml`.
   - Watch the matching run with `gh run watch <run-id> --exit-status`.
6. Verify npm publication for both packages.
   - `npm view @madebywild/agent-harness-manifest dist-tags --json`
   - `npm view @madebywild/agent-harness-framework dist-tags --json`
   - Confirm `latest` (or requested tag) points to `X.Y.Z`.
7. Report outcome with concrete evidence.
   - Include tag push result, workflow run id/status, and npm verification output summary.

## Troubleshooting

- If no workflow run appears, the tag was likely not pushed to remote.
- If prepublish fails, fix version mismatch or tag mismatch first.
- If publish fails with auth errors, confirm `NPM_TOKEN` in GitHub Actions secrets.
- If verify-published fails due lag, retry after npm propagation delay.
