# `packages/toolkit/src/skills-integration.ts`

## Purpose

Implements Harness-native integration with `skills.sh` for:

- `skill find` discovery parsing
- `skill import` sandboxed `skills add` execution
- audit extraction + strict allow/deny policy
- imported payload validation (paths, symlinks, UTF-8 text, size/count limits)

## Runtime model

- Uses a temporary sandbox directory for each invocation.
- Executes pinned `npx -y skills@1.4.6 ...`.
- For imports, reads copied payload from `.agents/skills/<upstream-skill>` inside the sandbox.
- Returns normalized files for engine-side write via existing `add skill` pipeline.

## Safety gates

- Audit policy defaults:
  - Block unaudited imports unless `allowUnaudited` is true.
  - Allow warn-level audit results (e.g. `Low Risk`, `Med Risk`) with a warning diagnostic.
  - Block fail-level audit results (e.g. `High Risk`, `Critical`) unless `allowUnsafe` is true.
- Payload policy:
  - Validates upstream skill ids (no path separators or traversal segments)
  - Requires top-level `SKILL.md`
  - Rejects symlinks
  - Rejects invalid/traversing paths
  - Text files are stored as UTF-8; binary files (e.g. fonts, images) are stored as base64
  - Enforces per-file and total payload size/count limits

## Key exports

- `SKILLS_CLI_VERSION`
- `findSkills(query, deps?)`
- `prepareSkillImport(input, deps?)`
- parser helpers:
  - `parseSkillsFindOutput(rawText)`
  - `parseSkillsImportReport(rawText, upstreamSkill)`
  - `classifyAuditOutcome(value)`
  - `evaluateSkillAudit(providers, options)`
