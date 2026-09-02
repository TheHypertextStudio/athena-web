# Land Pending Worktrees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish every piece of unlanded Docket work that still has value, land it on `main` with linear history, and leave no stale worktrees or branches behind.

**Architecture:** Four pieces of work are genuinely open: the FedCM-first Lattice authorization sitting dirty on `main`, the native credential contracts on `codex/android-credential-ux-server`, the repository bootstrap spec on a detached Codex worktree, and the evening-extension boundary loop on `cello/athena-web-1786475270`. Everything else in `git worktree list` and `git branch --no-merged` was verified (by patch-id or by zero residual diff against `origin/main`) to have already landed, or to have been superseded by a later implementation on `main`. Each open piece is rebased onto `origin/main` one at a time, in dependency order, because three of them add Drizzle migrations that must be renumbered against the migration journal as it stands when they land.

**Tech Stack:** git worktrees, pnpm + turbo, Drizzle Kit, Vitest, Hono, Next.js, Better Auth.

## Global Constraints

- Linear history only. `git rebase`, `git cherry-pick`, `git merge --ff-only`. `git rev-list --merges --count origin/main..HEAD` must print `0` before any push.
- Staging is always one chain: `git restore --staged . && git add <paths> && git commit -F <file>`.
- Commit types are `feat`, `fix`, `chore` only; scopes come from `COMMIT_SCOPES.txt`; body ≥ 100 characters; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Gates are the root turbo scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus `pnpm format:check`. Report gates from a full run, never a filtered one.
- No `rm -f` / `rm -rf`. Look at a path before deleting it.
- No pull requests. `main` is pushed directly after green gates, and only with the user's go-ahead.
- New timestamp columns must be `timestamp('col', { withTimezone: true })`. The `timestamptz-policy` test freezes each schema file's count of naive `timestamp(` calls (`packages/db/src/schema/agents.ts` is frozen at 51).
- Drizzle migrations are generated with `pnpm --filter @docket/db exec drizzle-kit generate --name <name>`, never hand-numbered. The journal on `origin/main` ends at `0121_milky_leopardon`.
- Every landed slice has a `docs/WORKLOG.md` entry moved to Completed with Files changed, Validation, and Learnings.

---

## Survey results (2026-09-01)

### Already landed on `origin/main` — remove worktree and branch

| Worktree / branch                                                                    | Evidence                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `CelloWork/worktrees/athena-web-1786230710` (`cello/athena-web-1786230710`)          | `route-task.ts` present on `origin/main`; later commits in lineage match by patch-id |
| `athena-web-1786234795`, `-1786237123`, `-1786251360` (same inbound-routing lineage) | all follow-up fixes match `origin/main` by patch-id                                  |
| `athena-web-1786236453`, `-1786251407` (day-cadence lineage)                         | `day-loop.ts`, `morning-review.tsx` present; `6dcacfa0` matches by patch-id          |
| `backup/pre-rebase`, `backup/pre-rebase-c6`                                          | zero residual diff vs `origin/main` on every non-WORKLOG file                        |
| `codex/docket-product-release` (remote gone)                                         | zero residual diff vs `origin/main` across 265 files                                 |
| `claude/lucid-williamson-6fd44a`, `claude/notion-prod-setup-command-0a993a`          | every `+` commit has zero residual diff                                              |
| `people-axis-fix-01`, `try-sync`, every `worktree-wf_*` branch                       | patch-id match or zero residual diff                                                 |

### Superseded — remove worktree, delete branch after the user confirms

| Worktree / branch                                                                                                         | Why                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `athena-web-1786473845` (`cello/athena-web-1786473845`, "Drain agent-assigned tasks to a delegation surface", 2026-08-11) | `origin/main` re-implemented it as `apps/api/src/agent/lattice-delegations.ts` + `lattice-delegation-runtime.ts` + `agentDelegation` schema, swept from `routes/cron.ts`. The old branch's own WORKLOG listed a real relay adapter as still owed; main now has one. |

### Open — this plan

| Work                                                      | Where                                                                                                                          | State                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FedCM-first Connect with Lovelace (`FEDCM-LATTICE-002`)   | dirty tree on `main` + 3 unpushed commits; Lovelace `codex/fedcm-lattice-authorization` (4 commits, 36 dirty files, 18 behind) | Code and tests done. Local `main` is 12 behind `origin/main`, and two of its five commits are duplicates of what was pushed. Three gate failures found: naive timestamps in `latticeAuthorizationAttempt`, a missing TSDoc (already fixed on origin), and a stale ignored `packages/types/` directory. |
| Native credential contracts (`ANDROID-CREDENTIAL-UX-001`) | `athena-web-credential-ux` worktree, `codex/android-credential-ux-server`                                                      | 1 commit, 5 behind. Auth, db, and web suites green. Migrations `0122`/`0123` collide with main's `0122_certain_hobgoblin`. Last subtask "validate" open.                                                                                                                                               |
| Repo bootstrap contract spec (`REPO-BOOTSTRAP-SPEC-001`)  | `.codex/worktrees/d706/athena-web`, detached at `b870ddee`                                                                     | Docs only, 111 behind. Only WORKLOG conflicts.                                                                                                                                                                                                                                                         |
| Evening extension boundary loop (`BOUNDARY-001`)          | `athena-web-1786475270`, `cello/athena-web-1786475270`                                                                         | Complete on 2026-08-11, never landed, 1142 behind. Adds `services/boundary/*`, migration `0080` (must be regenerated), hooks in `directive-sweep.ts` and `day-loop.ts` that still exist on main. **Needs the user to confirm the feature is still wanted** before Task 5 runs.                         |
| AI-writing-signs audit                                    | `.claude/worktrees/ai-writing-signs-audit-215bec`, no commits, 39 dirty files, 792 behind                                      | 30 of 39 files changed on main since. Prose-only. Preserved as a commit on its branch; Task 6 ports the 9 files that still apply plus the `AGENTS.md` intent.                                                                                                                                          |

---

### Task 0: Clean up landed and superseded worktrees

**Files:** none in the repo; git metadata only.

- [x] **Step 1: Preserve anything uncommitted or unreferenced.** The audit worktree's dirty changes are committed onto `claude/ai-writing-signs-audit-215bec`; the detached bootstrap commit gets a branch `codex/repo-bootstrap-spec` at `b870ddee`.
- [x] **Step 2: Remove every worktree whose branch is fully landed or superseded** with `git worktree remove <path>` then `git worktree prune`.
- [x] **Step 3: Delete the landed branches** with `git branch -D` (they are `--no-merged` only because they were rebased). Keep `cello/athena-web-1786473845` (superseded, unique commits) and `cello/athena-web-1786475270` (Task 5) until the user decides.
- [x] **Step 4: Delete the stale ignored `packages/types/` directory** (only `.turbo`, `coverage`, `dist`, `node_modules` remained) so `retired-types-package-policy.test.ts` passes locally as it does in CI.

---

### Task 1: Finish and land FedCM-first Lattice authorization on `main`

**Files:**

- Modify: `packages/db/src/schema/agents.ts` (the `latticeAuthorizationAttempt` table added in `cd5bf34d`)
- Regenerate: `packages/db/drizzle/0122_certain_hobgoblin.sql`, `packages/db/drizzle/meta/0122_snapshot.json`, `packages/db/drizzle/meta/_journal.json`
- Commit as-is: the 11 dirty files (`lattice-fedcm.ts`, `lattice-section.tsx`, their tests, `lattice-oauth.ts`, `dev-stack.sh`, `dev-stack.test.ts`, `apps/admin/package.json`, `pnpm-lock.yaml`, `docs/WORKLOG.md`) and the untracked plan `docs/superpowers/plans/2026-09-01-fedcm-first-lattice-authorization.md`
- Test: `packages/test-utils/tests/workspace-policies/timestamptz-policy.test.ts`, `packages/test-utils/tests/doc-coverage/doc-coverage.test.ts`

**Interfaces:**

- Produces: `main` at a commit that contains `origin/main` plus `latticeAuthorizationAttempt` with `timestamptz` columns and migration `0122_certain_hobgoblin`. Task 2's migrations renumber after it.

- [ ] **Step 1: Run the policy test to see it fail**

Run: `cd packages/test-utils && pnpm exec vitest run tests/workspace-policies/timestamptz-policy.test.ts`
Expected: FAIL, `{ file: 'agents.ts', allowed: 51, found: 55 }`.

- [ ] **Step 2: Make the four new columns timezone-aware**

In `packages/db/src/schema/agents.ts`, inside `latticeAuthorizationAttempt`, replace:

```ts
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
```

with:

```ts
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
```

Keep whatever chained `.$onUpdate(...)`/`.notNull()` follows `updatedAt` unchanged.

- [ ] **Step 3: Regenerate the migration instead of editing the SQL by hand**

```bash
git rm -q packages/db/drizzle/0122_certain_hobgoblin.sql packages/db/drizzle/meta/0122_snapshot.json
git checkout origin/main -- packages/db/drizzle/meta/_journal.json
pnpm --filter @docket/db exec drizzle-kit generate --name certain_hobgoblin
```

Expected: a new `0122_certain_hobgoblin.sql` whose `CREATE TABLE "lattice_authorization_attempt"` uses `timestamp with time zone` for all four columns, and a fresh `0122_snapshot.json`.

- [ ] **Step 4: Run the policy test to verify it passes**

Run: `cd packages/test-utils && pnpm exec vitest run tests/workspace-policies/timestamptz-policy.test.ts tests/workspace-policies/retired-types-package-policy.test.ts`
Expected: PASS (2 files).

- [ ] **Step 5: Commit the dirty FedCM work as one feature commit**

Write `/private/tmp/claude-501/.../scratchpad/fedcm-commit.txt`:

```
feat(athena): Connect with Lovelace through the browser's native dialog

Docket's explicit "Connect with Lovelace" action now tries the browser's active FedCM request
first and falls back to the redirect authorization flow when the browser declines. Authorization
attempts are separate rows from the active credential, so a dismissed or failed attempt never
damages a working connection. The four attempt timestamps store instants (timestamptz) so the
schema policy holds, and the migration is regenerated accordingly. The development stack script
learns the FedCM origin, with coverage in repo-tests.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

```bash
git restore --staged . && git add apps/admin/package.json apps/api/tests/routes/lattice-routes-branches.test.ts 'apps/web/src/app/(app)/settings/athena/lattice-fedcm.ts' 'apps/web/src/app/(app)/settings/athena/lattice-section.tsx' apps/web/tests/athena/lattice-fedcm.test.ts apps/web/tests/athena/lattice-section.test.tsx docs/WORKLOG.md packages/integrations/src/lattice-oauth.ts pnpm-lock.yaml repo-tests/tooling/dev-stack.test.ts scripts/dev-stack.sh packages/db/src/schema/agents.ts packages/db/drizzle docs/superpowers/plans/2026-09-01-fedcm-first-lattice-authorization.md && git commit -F "$SCRATCH/fedcm-commit.txt"
```

- [ ] **Step 6: Rebase local `main` onto `origin/main`**

```bash
git rebase origin/main
```

Expected: `ae463cef` and `ec112403` are dropped automatically (identical patches already on origin). Two conflicts are likely: `docs/WORKLOG.md` (keep both the origin entries and the local `FEDCM-LATTICE-002` entry, origin's `FEDCM-LATTICE-001` entry stays where origin put it) and `domains/athena/src/turn/internal/lattice-tool-protocol.ts` (take origin's version, which carries the TSDoc on `renderToolInstructions` from `19dde2cc`). Resolve, `git add`, `git rebase --continue`.

- [ ] **Step 7: Verify the rebase is linear and the doc-coverage test passes**

```bash
git rev-list --merges --count origin/main..HEAD
cd packages/test-utils && pnpm exec vitest run tests/doc-coverage/doc-coverage.test.ts
```

Expected: `0`, then PASS.

- [ ] **Step 8: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Expected: all green. If `pnpm test` fails only in `tests/athena/phone-call-summary-sheet.test.tsx` with a 30 s timeout, rerun with `CI=1 pnpm test --force` (known host race, see `TEST-STABILITY-001`).

- [ ] **Step 9: Update the WORKLOG entry**

Move `[FEDCM-LATTICE-002]` from Active to Completed. Keep the recorded blocker verbatim as a **Blockers for launch** subsection: native-dialog acceptance needs a fresh Chrome profile and the user's passkey, and production needs both repositories deployed plus the `feature.auth.fedcm_oauth_authorization` flag. Commit:

```bash
git restore --staged . && git add docs/WORKLOG.md && git commit -F "$SCRATCH/fedcm-worklog.txt"
```

with a `chore(athena): Record the FedCM authorization slice as landed` subject and a ≥100-character body.

- [ ] **Step 10: Lovelace side (separate repository, its own conventions)**

In `/Users/williecubed/Projects/ReasonableTech/lovelace` on `codex/fedcm-lattice-authorization`: commit the 36 dirty files as the feature commit they belong to (feature-flags-service capability flag, landing `.well-known/web-identity` route, accounts-service FedCM schemas and session middleware), then `git rebase origin/main` (18 behind), then run that repository's 7-step pre-push hook. Lovelace has no WORKLOG; its notes go in `docs/plans` per its conventions. Pushing Lovelace and enabling the rollout flag are user-authorized actions, so stop and report after the hook is green.

---

### Task 2: Land native credential management contracts

**Files:**

- Branch: `codex/android-credential-ux-server` (commit `8f153488`), worktree `/Users/williecubed/Projects/TheHypertextStudio/athena-web-credential-ux`
- Regenerate: `packages/db/drizzle/0122_awesome_shiva.sql` → `0123_*`, `0123_spooky_vulcan.sql` → `0124_*`, their snapshots, `_journal.json`
- Modify: `docs/WORKLOG.md` (`ANDROID-CREDENTIAL-UX-001`)

**Interfaces:**

- Consumes: `main` from Task 1 (journal ends at `0122_certain_hobgoblin`).
- Produces: `packages/auth/src/restore-credential.ts`, typed passkey-management contracts in `domains/identity-access/src/contracts/passkey-management.ts`, `publicConfig.googleServerClientId` in `public-config.ts`, and migrations `0123`/`0124` on `main`.

- [ ] **Step 1: Rebase the branch onto the new `main`**

```bash
cd /Users/williecubed/Projects/TheHypertextStudio/athena-web-credential-ux
git fetch origin && git rebase main
```

Expected: conflicts in `docs/WORKLOG.md` (keep both), `packages/db/drizzle/meta/_journal.json`, and an add/add on `packages/db/drizzle/meta/0122_snapshot.json`. Resolve the two migration files by taking `main`'s versions wholesale; the branch's own migrations are regenerated in Step 2.

- [ ] **Step 2: Regenerate the branch's two migrations on top of `0122`**

```bash
git rm -q packages/db/drizzle/0122_awesome_shiva.sql packages/db/drizzle/0123_spooky_vulcan.sql packages/db/drizzle/meta/0123_snapshot.json
git checkout main -- packages/db/drizzle/meta/0122_snapshot.json packages/db/drizzle/meta/_journal.json
pnpm --filter @docket/db exec drizzle-kit generate --name native_credentials
```

Expected: one `0123_native_credentials.sql` containing the union of the two old files (passkey `last_used_at` plus the `restore_credential` table) and a `0123_snapshot.json`. Read the SQL and confirm every new timestamp column is `timestamp with time zone`.

- [ ] **Step 3: Run the schema policy and db suites**

```bash
cd packages/test-utils && pnpm exec vitest run tests/workspace-policies
cd ../db && pnpm exec vitest run
```

Expected: PASS. If `timestamptz-policy` reports `auth.ts` over its allowance, convert the branch's new columns to `{ withTimezone: true }` and repeat Step 2.

- [ ] **Step 4: Amend the feature commit with the regenerated migration**

```bash
git restore --staged . && git add packages/db/drizzle docs/WORKLOG.md && git commit --amend --no-edit
```

- [ ] **Step 5: Run the full gates in the worktree**

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 6: Close the open subtask and land**

Tick `- [x] Validate migrations, compatibility, API behavior, and the web Security journey.` in the WORKLOG entry, move it to Completed, amend. Then:

```bash
cd /Users/williecubed/Projects/TheHypertextStudio/athena-web
git merge --ff-only codex/android-credential-ux-server
git rev-list --merges --count origin/main..HEAD
git worktree remove /Users/williecubed/Projects/TheHypertextStudio/athena-web-credential-ux && git branch -d codex/android-credential-ux-server
```

Expected: fast-forward, `0`, worktree gone.

---

### Task 3: Land the repository bootstrap contract spec

**Files:**

- Cherry-pick: `b870ddee` (branch `codex/repo-bootstrap-spec`) — adds `docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md`, edits `docs/WORKLOG.md`

- [ ] **Step 1: Cherry-pick onto `main`**

```bash
git cherry-pick codex/repo-bootstrap-spec
```

Expected: conflict only in `docs/WORKLOG.md`. Keep the `REPO-BOOTSTRAP-SPEC-001` entry under Active Tasks with `Status: REVIEW`, resolve, `git cherry-pick --continue`.

- [ ] **Step 2: Verify the doc still reflects reality**

Read the spec once. It compares Docket's bootstrap with the website's; `origin/main` has since gained `scripts/deploy-doctor` and the drift report (`71896ee5`). Add one paragraph to the spec's "Docket today" section naming the drift report as the existing convergence check so the spec does not describe a pre-drift-report Docket. Commit:

```bash
git restore --staged . && git add docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md docs/WORKLOG.md && git commit -F "$SCRATCH/bootstrap-spec.txt"
```

Subject: `chore(dx): Note the drift report in the bootstrap contract spec`.

- [ ] **Step 3: Gates and branch removal**

```bash
pnpm format:check && pnpm exec vitest run repo-tests
git branch -d codex/repo-bootstrap-spec
```

---

### Task 4: Port the AI-writing-signs audit that still applies

**Files:**

- Source: branch `claude/ai-writing-signs-audit-215bec` (one WIP commit made by Task 0)
- Apply cleanly (unchanged on main since the audit's base): the 9 files reported by `git diff --name-only` whose blob at `25b47fc6` equals their blob on `origin/main` — `.claude/skills/docs.md`, `.claude/skills/plan.md`, `.claude/skills/retro.md`, `.claude/skills/status.md`, `.claude/skills/worklog.md`, `docs/design/audits/2026-07-06-athena-surfaces.md`, `docs/design/audits/2026-08-02-calendar-round-2.md`, `docs/design/audits/2026-08-02-oauth-authorize.md`, `packages/service-worker/src/worker/documents.ts`
- Re-do by hand: `AGENTS.md` (collapse the bold-label lists in "Mandatory Documentation" and "Commit Frequency" into positive prose, per the audit's diff)
- Drop: the other 29 files; their prose has been rewritten on main since

- [ ] **Step 1: Apply the nine clean files**

```bash
for f in .claude/skills/docs.md .claude/skills/plan.md .claude/skills/retro.md .claude/skills/status.md .claude/skills/worklog.md docs/design/audits/2026-07-06-athena-surfaces.md docs/design/audits/2026-08-02-calendar-round-2.md docs/design/audits/2026-08-02-oauth-authorize.md packages/service-worker/src/worker/documents.ts; do
  git diff 25b47fc6 claude/ai-writing-signs-audit-215bec -- "$f" | git apply --3way
done
git status --short
```

Expected: nine modified files, no `.rej`.

- [ ] **Step 2: Port the `AGENTS.md` edits by hand**

Replace the three-item bold list under "### Mandatory Documentation" with:

```markdown
1. Code comments (TSDoc format) on all exported functions, classes, and types; on complex or non-obvious logic; and cross-references to related code
2. A `docs/WORKLOG.md` entry covering the task description, approach taken, files modified, and decisions made
3. README updates when the change adds a feature, changes an API or interface, or changes setup instructions
```

Replace the three bullets under "### Commit Frequency" with:

```markdown
Commit atomically — one logical change per commit, frequent and small rather than one large drop. Never commit code that fails validation.
```

Bump the header to `**Version**: 2.1.1` and `**Last Updated**: 2026-09-01`.

- [ ] **Step 3: Run the tests that read those files, then commit**

```bash
cd packages/service-worker && pnpm exec vitest run
cd ../.. && pnpm format:check && pnpm exec vitest run repo-tests
git restore --staged . && git add AGENTS.md .claude/skills docs/design/audits packages/service-worker/src/worker/documents.ts && git commit -F "$SCRATCH/audit-port.txt"
```

Subject: `chore: Port the writing-signs audit to the files it still fits`. Then `git branch -D claude/ai-writing-signs-audit-215bec`.

---

### Task 5: Port the evening-extension boundary loop (after the user confirms it is still wanted)

**Decision required first.** `BOUNDARY-001` asks a device-control MCP client for up to two hours more evening when today's remaining work no longer fits. It was complete on 2026-08-11 but never landed, and the curfew spec on `main` (§4A) has since described `curfew-mcp` as a local server. Ask the user whether this behavior is still wanted before doing any of the steps below. If not, delete `cello/athena-web-1786475270` and stop.

**Files:**

- Cherry-pick: `522acf71` — creates `apps/api/src/services/boundary/{port,registry,mcp-adapter,extension-service}.ts` and their three test files; modifies `apps/api/src/routes/directive-sweep.ts`, `apps/api/src/services/scheduling/day-loop.ts`, `packages/db/src/schema/scheduling.ts`, `docs/engineering/specs/curfew-integration.md`, `docs/WORKLOG.md`
- Regenerate: migration `0080_tense_george_stacy.sql` → next number after Task 2's

**Interfaces:**

- Produces: `advanceEveningExtension(db, context, { port, now })` returning `{ submitted: boolean; resolved: number }`, `getDayBoundaryPort()` from `services/boundary/registry.ts`, `assessEveningShortfall` in `day-loop.ts`, and `DirectiveSweepResult.extensionsRequested/extensionsResolved`.

- [ ] **Step 1: Cherry-pick and resolve**

```bash
git cherry-pick 522acf71
```

Expected conflicts: `docs/WORKLOG.md` (keep both), `packages/db/drizzle/meta/_journal.json` and add/add `0080_snapshot.json` (take `main`'s), possibly `day-loop.ts` (main's `computeDirectivePosture`, `buildCheckInSchedule`, and `DriftTrigger` were added since; keep all of main and add the branch's `assessEveningShortfall`).

- [ ] **Step 2: Regenerate the migration**

```bash
git rm -q packages/db/drizzle/0080_tense_george_stacy.sql
git checkout main -- packages/db/drizzle/meta/0080_snapshot.json packages/db/drizzle/meta/_journal.json
pnpm --filter @docket/db exec drizzle-kit generate --name evening_extension_request
```

Convert every new column in `packages/db/src/schema/scheduling.ts` to `{ withTimezone: true }` before generating, and confirm the unique index on `(hub_id, date, deadline_key)` is present in the SQL.

- [ ] **Step 3: Run the ported suites**

```bash
cd apps/api && pnpm exec vitest run tests/services/boundary tests/routes/directive-sweep tests/services/scheduling
cd ../../packages/test-utils && pnpm exec vitest run tests/workspace-policies tests/doc-coverage
```

Expected: PASS. Any failure is fixed in code, then `git commit --amend --no-edit`.

- [ ] **Step 4: Full gates, WORKLOG to Completed, delete the branch**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
git branch -D cello/athena-web-1786475270
```

---

### Task 6: Push `main`

- [ ] **Step 1: Final verification**

```bash
git fetch origin && git rebase origin/main && git rev-list --merges --count origin/main..HEAD && git status --short
```

Expected: `0` and a clean tree. Rerun the gates if the rebase pulled anything new.

- [ ] **Step 2: Push, with the user's go-ahead**

```bash
git push origin main
```

Then watch CI; deploys are gated on green CI, and E2E is not a deploy gate.

- [ ] **Step 3: Decide the superseded delegation branch**

Ask the user whether `cello/athena-web-1786473845` may be deleted. Its `DelegationPort`/`MockDelegation` shape has been replaced on `main` by the Lattice relay runtime; nothing in it is referenced.
