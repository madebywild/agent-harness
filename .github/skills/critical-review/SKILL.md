---
name: critical-review
description: Run a multi-round critical review loop using specialized subagents. Use when the user asks to review changes, harden code, or ensure quality before merge. Spawns parallel review agents across security, core-logic, tests, CLI integration, and API surface, then iterates fix-and-re-review rounds until all agents report clean.
---

# critical-review

Run a comprehensive, multi-round critical review of recent changes using specialized subagents.

Use `$ARGUMENTS` as a scope hint when provided (e.g., a module name, file glob, or feature area). When omitted, review all uncommitted or recently committed changes on the current branch.

## Review agents

Spawn these five review agents **in parallel** each round:

| Agent type | Focus |
|---|---|
| `security-reviewer` | Path traversal, injection, symlinks, deletion safety, permission checks, DoS vectors |
| `core-logic-reviewer` | DRY violations, type safety, edge cases, error propagation, maintainability |
| `test-reviewer` | Coverage gaps, assertion quality, test isolation, DRY in tests, E2E reliability |
| `cli-integration-reviewer` | Command registry, renderer, interactive adapter, commander adapter consistency |
| `api-docs-reviewer` | Naming conventions, documentation completeness, barrel exports, breaking change risk |

Each agent prompt must:
- List the specific files to review (use `git diff --name-only` against the base branch to identify them).
- Describe what was already fixed in prior rounds so the agent does not re-report resolved issues.
- Request findings categorized as HIGH / MEDIUM / LOW / INFO with clear descriptions.
- Ask the agent to report "No findings." if everything is clean.

## Steps

1. **Identify scope.**
   - Run `git diff --name-only` (staged + unstaged) and `git log --oneline` to determine which files changed.
   - If `$ARGUMENTS` narrows the scope, filter the file list accordingly.
   - Read each changed file to have full context before spawning reviewers.

2. **Round N: Spawn review agents.**
   - Launch all five agents in parallel using the `Agent` tool with the appropriate `subagent_type`.
   - Each agent prompt must be self-contained: include file paths, prior-round context, and what to check.
   - Collect all findings.

3. **Triage findings.**
   - Aggregate results into a table: `| Reviewer | HIGH | MEDIUM | LOW | INFO |`.
   - Identify all HIGH and MEDIUM findings that are actionable and specific to the changes (ignore pre-existing codebase issues not introduced by the changes).

4. **Fix findings.**
   - Apply fixes for all HIGH findings and all MEDIUM findings that represent real bugs, behavioral inconsistencies, or security issues.
   - For MEDIUM findings that are stylistic or pre-existing patterns, note them but do not fix unless they are trivially addressable.
   - Run quality gates after fixes: `pnpm check:write`, `pnpm typecheck`, and relevant tests.

5. **Iterate.**
   - If any HIGH or MEDIUM findings were fixed, go back to step 2 for the next round.
   - In each subsequent round, tell agents what was fixed so they verify the fixes and look for new issues.
   - Continue until **all agents report no remaining HIGH or MEDIUM findings**.

6. **Report.**
   - Summarize all rounds: what was found, what was fixed, what was intentionally deferred.
   - Present the final findings table showing all agents clean.

## Rules

- **Never skip a round.** Even if only one agent had findings, re-run all five to catch regressions.
- **Fix, don't suppress.** Address root causes. Do not silence findings by removing tests or weakening assertions.
- **Stay in scope.** Do not refactor code unrelated to the changes under review.
- **Permission-dependent tests** that fail when running as root should use `skip: process.getuid?.() === 0 && "root bypasses file permissions"`.
- **Pre-existing failures** (e.g., tests in other modules that were already failing) should be noted but not counted against the review.
- Track progress with `TodoWrite` so the user can see round-by-round status.

## Quality gates

Run these after every fix round, before spawning the next review:

```bash
pnpm check:write          # Biome lint + format with auto-fix
pnpm typecheck            # Type-check all packages
pnpm test                 # Unit tests (or targeted test file)
```

## Exit criteria

The review loop is complete when:
1. All five agents report **zero HIGH and zero MEDIUM** findings on the changes.
2. All quality gates pass.
3. Changes are committed and pushed.
