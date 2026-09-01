# Public documentation and paid-launch implementation plan

The release maintainer must execute this plan in order. The plan ends when the public guide matches
production, the operating record is complete, the paid canary has remained clean for 72 hours, and
public Checkout has opened through an explicit launch decision.

The design decisions and safety boundaries live in
[`../specs/2026-08-25-public-docs-refresh-design.md`](../specs/2026-08-25-public-docs-refresh-design.md).
This plan uses the existing local development stack, authenticated session tool, screenshot tool,
Mintlify site, deployment workflow, and billing audit. It does not add a parallel verification path.

## Gate 1: Restore a safe baseline

- [x] Fetch current `origin/main`, rebase the branch, and verify that the branch has no merge
      commits.
- [x] Replace every instruction that creates documentation fixtures in production.
- [x] Make the screenshot tool reject non-local session metadata before it creates fixtures or
      writes screenshots.
- [x] Locate the current machine-resource status command or record that the superseded watchdog is
      no longer active before a repository-wide build.
- [x] Verify the exact production workspace `Docket Documentation Demo`
      (`01M0XDAP2DMBR3RPA4H4GSS8XN`) through the Hypertext Studio operating context.
- [x] Confirm that the workspace contains no customer data, active members beyond the creating
      operator, Stripe customer, subscription, invoice, credit, discount, integration, or retained
      legal record.
- [x] Remove only that workspace through an audited maintenance action. Record the actor, time,
      target, precondition results, and outcome.
- [x] Verify that account preferences, workspace switchers, sessions, search indexes, billing
      indexes, and analytics dimensions no longer point at the removed workspace.

This gate fails if the production target cannot be proved or if any check finds unrelated state.
The operator does not rename, hide, repurpose, or partially clean the workspace.

## Gate 2: Rebaseline the launch ledger

- [ ] Record the current `origin/main` commit, production web commit, API deployment revision,
      Mintlify deployment, database migration level, and public feature flags.
- [ ] Replace the stale status on all 399 launch-ledger rows with current evidence.
- [ ] Give every row one result: pass, partial, fail, not built, or unverifiable.
- [ ] Attach a source path, production check, test, deployment record, or operator record to every
      pass.
- [ ] Treat partial, fail, not built, and unverifiable launch blockers as closed gates.
- [ ] Assign one owner and one next action to every open blocker.
- [ ] Separate product readiness, documentation readiness, billing readiness, security, privacy,
      operations, support, and acquisition so one category cannot mask another.
- [ ] Publish a dated baseline report in the repository and link it from the work log.

The baseline must cover the complete public surface. It includes signup, passkeys, OAuth, workspace
creation, navigation, work objects, search, file handling, imports, integrations, Athena, MCP,
notifications, billing, export, deletion, accessibility, responsive behavior, errors, rate limits,
privacy, support, backups, restore, observability, incident response, and rollback.

## Gate 3: Clear product and operating blockers

- [x] Reproduce every failure on the latest `main` before changing code. Do not carry failure lists
      forward from an older deployment without checking them.
- [x] Repair the current API test failures and run the affected package suite with bounded workers.
- [ ] Repair the current browser-suite failures and rerun every cancelled shard.
- [x] Restore a checked-in `launch:verify-prod` command that verifies the public web host, API
      health, OpenAPI, auth metadata, docs host, redirects, and immutable asset delivery.
- [x] Fix the production OpenAPI route and prove that the live schema matches the deployed API.
- [ ] Add a recoverable workspace-deletion flow. `DELETE /v1/orgs/:orgId` schedules deletion after
      fresh authentication and owner confirmation. `POST /v1/orgs/:orgId/reactivation` restores it
      during the recovery window.
- [ ] Remove pending-deletion workspaces from normal switching and search immediately. Keep purge
      independent from billing state. Honor legal and security holds.
- [ ] Prove account deletion, workspace deletion, export, backup, restore, retention, and purge with
      behavior tests and an operator runbook.
- [ ] Verify application-owned error copy. Do not expose provider exceptions or Problem details.
- [ ] Confirm rate limits, abuse controls, security headers, secret boundaries, audit events, alert
      destinations, support intake, status communication, and rollback ownership.

This gate passes only when the release candidate has a complete green CI run and the production
verification command passes against the deployed candidate with Checkout still closed.

## Gate 4: Rebuild the Mintlify guide

- [x] Inventory every existing URL and add a redirect before moving or splitting a page.
- [x] Update `apps/docs/docs.json` to group Guides by getting started, planning and doing work,
      organizing work, finding work, managing Docket, and Athena.
- [x] Split Tasks from Triage, Inbox from Stream, Search from Views, Cycles from milestones,
      Initiatives from Programs, Connections from Imports, and Templates from Automations and
      Publishing.
- [x] Split account and workspace settings along the navigation that production shows.
- [x] Rewrite every GA page with one clear title, a direct opening answer, action-based sections,
      exact product labels, permissions, limits, recovery steps, and related links.
- [x] Remove persona announcements, launch prose, implementation history, duplicated endpoint
      schemas, and claims that lack production evidence.
- [x] Keep experimental features out of GA navigation. Add a clearly marked preview section only
      when the feature has a production owner, support boundary, and evidence.
- [x] Update developer guidance against live OAuth metadata, MCP registration, scopes, stable
      errors, rate limits, and Scalar anchors.
- [x] Rewrite the change log as dated customer outcomes based on successful production deployments.
- [ ] Add maintenance metadata that links each page to launch-ledger evidence without putting
      internal commit details in public prose.

No page passes review when a product label, URL, permission, shortcut, limit, or recovery step is
guessed from source alone.

## Gate 5: Add visual and editorial evidence

- [ ] Start the documented local stack with `scripts/dev-stack.sh` and create the authenticated
      local session with `apps/web/e2e/tools/dev-session.ts`.
- [ ] Seed one consistent local-only documentation fixture through the existing API helper.
- [ ] Capture the pages where layout or state needs a picture at 1440 by 900 and 390 by 844 in both
      themes. Run the 320-pixel overflow check.
- [ ] Remove personal data, tokens, provider identifiers, and unstable timestamps from every asset.
- [ ] Write alternative text that explains the state or action shown.
- [ ] Review every page in rendered Mintlify at desktop and phone widths in light and dark themes.
- [ ] Run a copy pass for direct openings, exact labels, sentence grammar, duplicate explanation,
      dead ends, unsupported claims, and application-owned error language.
- [ ] Reset the shared local database after captures.

Production browser verification remains read-only. The operator uses the dedicated Hypertext Studio
profile. Screenshots never use production data.

## Gate 6: Enforce documentation quality

- [x] Add `mint validate`, `mint broken-links --check-anchors --check-redirects --check-snippets`,
      and `mint a11y` to the documentation package and CI graph.
- [ ] Check navigation coverage, redirects, referenced assets, duplicate titles, orphan pages,
      product vocabulary, MCP tool names, OAuth scopes, canonical hosts, and LLM text files.
- [x] Add a customer-facing-change declaration to the repository workflow. Each product change must
      state that docs changed, docs do not change with a reason, or docs remain blocked.
- [x] Fail CI when a change affects a documented surface but supplies neither a docs change nor an
      accepted no-change reason.
- [ ] Keep policy tests focused on behavior and generated site contracts. Do not enforce prose by
      searching for arbitrary sentence fragments.
- [ ] Document the docs owner, product reviewer, release reviewer, review cadence, stale-page
      response, and emergency correction path.

## Gate 7: Publish with Checkout closed

- [ ] Freeze the release-candidate commits for web, API, migrations, docs, and billing config.
- [ ] Run formatting, lint, type checking, unit tests, integration tests, browser tests, coverage,
      and production builds with bounded concurrency.
- [ ] Rebase onto current `origin/main` and verify linear history again.
- [ ] Deploy the product candidate with public Checkout disabled.
- [ ] Run the production verification command and read-only authenticated core journeys.
- [ ] Publish Mintlify only after the deployed product passes.
- [ ] Verify the live docs navigation, search, assets, redirects, code samples, API links,
      `llms.txt`, `llms-full.txt`, desktop layout, phone layout, and both themes.
- [ ] Record the deployed commits, deployment identifiers, results, owners, known limits, and
      rollback commands.

A docs failure rolls back the docs deployment. A product failure rolls back the product candidate.
Neither failure opens Checkout.

## Gate 8: Prove billing and open paid acquisition

- [ ] Verify that all Stripe objects belong to the Hypertext Studio account before reading or
      changing provider state.
- [ ] Prove hosted Checkout, customer portal, webhook verification and replay protection, tax,
      failed cards, SCA, cancellation, reactivation, invoices, discounts, credits, refunds, and
      reconciliation in the release environment.
- [ ] Run billing reconciliation in shadow mode for at least 24 hours with Checkout disabled.
- [ ] Obtain explicit approval immediately before a real charge.
- [ ] Complete one live $8 purchase through Checkout. Verify the entitlement, invoice, webhook
      record, portal, cancellation, reactivation, credit or refund, Founder grant, and discounted
      subscription paths in the Hypertext Studio account.
- [ ] Switch reconciliation to active canary mode and observe it for 72 hours.
- [ ] Stop the launch when any mismatch, webhook backlog, alert, support issue, or unexplained state
      appears. Close new Checkout sessions before changing existing subscriptions.
- [ ] Open public Checkout only after the observation record stays clean and the release owner signs
      the launch record.
- [ ] Run immediate post-launch checks, then repeat them after one hour, 24 hours, and seven days.

The final launch record must state what shipped, what remains limited, who owns each operating path,
how to close Checkout, how to roll back the application and docs, and where billing reconciliation
and customer support evidence lives.
