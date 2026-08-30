# Skill: verify-ui

Bring the stack up in a worktree, sign in headlessly, and capture the standard shot set for a
surface. Use this instead of assembling a dev environment by hand.

## Invocation

/verify-ui <route> [<route> ...]

## Before anything else

Read `docs/engineering/ui-verification.md`. It carries the failure modes and their fixes. Do not
create a launch-config entry, a dev script, a sign-in flow, or a screenshot script — all of them
already exist, and this skill is the order to run them in.

## Actions

1. **Start the stack.** `bash scripts/dev-stack.sh start` — blocks until web, API, and OIDC all
   answer 200, then prints the env. It stops anything already running first, so it is safe to re-run.
2. **Export the origins.** `eval "$(bash scripts/dev-stack.sh env)"` — these are branch-derived, so
   never hardcode a hostname.
3. **Get a session.** From `apps/web`:
   `APP_URL="$APP_URL" PASSKEY_RP_ID="$PASSKEY_RP_ID" pnpm exec tsx e2e/tools/dev-session.ts --label=<audit> --out=playwright/.auth/<name>.json`
   If it times out waiting for `#name`, the route was compiling — `curl "$APP_URL/sign-up"` once and
   re-run.
4. **Seed.** A fresh account is empty, and empty-state screenshots are not coverage. POST through the
   API with the session cookie. A task needs `teamId` (from `/v1/orgs/:orgId/teams`) and
   `assigneeId` (the `actorId` field from `/v1/orgs/:orgId/members`). Compute the date in the Hub's
   timezone from `/v1/hub/preferences`, not UTC.
5. **Capture.** From `apps/web`:
   `APP_URL="$APP_URL" pnpm exec tsx e2e/tools/capture-shots.ts --session=playwright/.auth/<name>.json --out=.data/design-review/<date> <routes>`
   This covers 1440×900 and 390×844, light and dark, and asserts no horizontal overflow at 320px.
6. **Look at every image.** Report what is actually in them. A capture that ran is not a surface that
   was checked.
7. **Reset the database.** `pnpm db:reset` — the dev database is the same file `@docket/api`'s tests
   read, so seeded fixtures will fail them until it is reset.

## Reporting

State which plan/data states were actually captured and name any state that was not. If a surface
has branches (empty, populated, error), a screenshot of one branch is evidence for that branch only.

For a scored craft review rather than raw captures, use the `design-review` skill, which consumes
this same shot set.
