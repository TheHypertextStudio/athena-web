# Public documentation and paid-launch design

Docket maintainers must use this design to bring the public guide into line with production and to
open paid signup without exposing unfinished behavior. The launch keeps Checkout closed until the
product, documentation, billing, and operating procedures pass their own gates.

## Decisions

`docket.hypertext.studio` is Docket's primary public domain. The guide describes only behavior that
works through that domain and the deployed API. Source code, a merged commit, or a passing local
test does not prove that a feature is available to a customer.

The public guide uses Linear's feature-first pattern. One page answers one product question. Each
page opens with the answer, then shows the exact actions, labels, limits, recovery paths, and related
features. A page does not announce a persona or tell the reader who they are.

The guide documents the production-proven core. Experimental capabilities stay out of the main
navigation until production evidence supports them. Scalar remains the endpoint reference.
Mintlify explains authentication, tool selection, task flows, and stable errors without copying the
OpenAPI schema.

Documentation publishes before public Checkout opens. Publishing the guide does not enable paid
signup. Checkout opens only after the release candidate passes production verification, the
Hypertext Studio Stripe canary succeeds, and the 72-hour observation period remains clean.

## Production safety

No documentation, screenshot, test, seed, audit, or launch script may create synthetic workspaces,
records, trials, subscriptions, discounts, or invoices in production. Documentation screenshots
use the existing local development fixture and authenticated local capture tools. The capture tool
must reject every non-local base URL before it creates fixture data.

The approved production cleanup has one target: `Docket Documentation Demo`
(`01M0XDAP2DMBR3RPA4H4GSS8XN`). The operator must first prove that the workspace is synthetic and
has no customer records, paid subscription, invoice, credit, or unrelated member. The operator may
then remove that exact workspace through an audited maintenance path. The operator must stop when
any check disagrees. The cleanup does not authorize deletion of any other production state.

Stripe work uses the Hypertext Studio account and the dedicated Hypertext Studio browser profile.
No operator may use a personal Chrome profile or a global personal Stripe CLI profile. A real paid
canary incurs cost, so the operator must obtain explicit approval immediately before the charge.

## Documentation structure

The site keeps Guides, Developers, and Changelog as its top-level tabs. The Guides tab groups pages
by the job a person is trying to complete:

- Getting started covers signup, navigation, workspace setup, and first work.
- Plan and do work covers Today, My Work, Tasks, Triage, Calendar, Time, Inbox, and Stream.
- Organize work covers Projects, Initiatives, Programs, Cycles, Teams, people, labels, statuses, and
  work structure.
- Find and understand work covers Search, Views, Library, Graph, Portfolio, and activity history.
- Manage Docket covers members and access, connections, imports, templates, automations, publishing,
  billing, security, notifications, work locations, and data controls.
- Athena covers chat, agent sessions, permissions, approvals, connected apps, and failure recovery.

Existing public paths remain valid through retained pages or explicit redirects. Combined pages
split when they answer separate questions. Tasks no longer shares a page with Triage. Inbox no
longer shares a page with Stream. Search no longer shares a page with Views. Cycles no longer shares
a page with milestones. Initiatives no longer shares a page with Programs. Connections no longer
shares a page with Imports. Templates no longer shares a page with Automations and Publishing. The
account-settings page splits along the settings navigation instead of becoming a second settings
screen in prose.

## Page contract

Every guide page must contain the following information when the feature needs it:

1. The first sentence states what the feature does or how to complete the task.
2. Action sections use the labels that production shows.
3. A screenshot appears only when layout or state is easier to understand visually.
4. Keyboard shortcuts, permissions, limits, and side effects appear beside the action they affect.
5. Empty states, failure states, and recovery steps use application-owned copy.
6. Related links help the person continue without repeating the current page.
7. The page records the production evidence and release commit in its maintenance metadata or the
   launch ledger, not in customer-facing prose.

Screenshots use one consistent local fixture. The fixture contains no real names, email addresses,
tokens, workspace identifiers, or provider data. Captures cover 1440 by 900 and 390 by 844 in light
and dark themes. A 320-pixel pass checks overflow. Alternative text explains the useful state, not
the fact that the asset is a screenshot.

## Evidence and release gates

The release uses five gates. Each gate produces a record that the next gate can check.

1. The product gate maps every launch-ledger claim to current source, a deployment commit, a
   production route, a feature flag, and a verification result. Unknown claims fail closed.
2. The documentation gate validates Mintlify configuration, links, anchors, redirects, snippets,
   accessibility, screenshots, search, and the generated LLM text files.
3. The production gate checks public routes, authenticated core journeys, the OpenAPI route,
   application-owned errors, logging, alerts, backups, deletion recovery, and rollback controls.
4. The billing gate proves the Hypertext Studio Stripe configuration, webhook processing, tax,
   portal, cancellation, reactivation, discounts, credits, reconciliation, and the approved live
   canary.
5. The acquisition gate opens Checkout only after the 72-hour canary observation stays clean and
   the launch record names the deployed commits, remaining limits, owner, and rollback command.

The release sequence diagram is in
[`2026-08-31-docs-paid-launch-sequence.mmd`](2026-08-31-docs-paid-launch-sequence.mmd). The
maintainer sends one release candidate through CI and production verification. Mintlify publishes
the verified guide while Checkout remains closed. Stripe receives the approved canary only after
those checks pass. The maintainer opens Checkout after the observation gate.

## Documentation ownership

Every customer-facing change must declare one of three documentation outcomes: docs changed in the
same product slice, docs unchanged with a reason, or docs blocked with a named launch consequence.
CI checks the declaration and the files that changed. Product code owners review behavior. The docs
owner reviews labels, structure, links, and screenshots. The release owner checks production truth
before publication.

The change log groups releases by customer-visible result and production date. It does not dump
commit subjects. Internal implementation detail stays in engineering records unless a customer
must act on it.

## Operations and rollback

The launch runbook must name the owner for deployment, docs publication, billing, support, incident
response, and rollback. It must include public status checks, alert destinations, support intake,
backup and restore evidence, data-export checks, deletion recovery, billing reconciliation, and the
steps that disable Checkout without taking the existing product offline.

Checkout is the first rollback control. Operators can close paid acquisition while they investigate
the application, docs, or billing. A docs rollback restores the last verified Mintlify deployment.
A product rollback restores the last verified web and API commits. A billing rollback stops new
Checkout sessions and leaves existing subscriptions under reconciliation.

## Rejected approaches

Production demo data is rejected because it changes customer state for documentation evidence and
can contaminate billing, analytics, search, and screenshots. A hidden or clearly named demo
workspace does not make that safe.

A code-first documentation audit is rejected because merged behavior can still be disabled,
undeployed, or broken at the public route. A single launch checklist is rejected because it allows
one green area to conceal a failure in another. Enabling Checkout when the docs publish is rejected
because publication is easy to reverse and live billing is not.

## Open work

The current launch ledger, production deployment state, feature flags, OpenAPI health, current CI,
and billing reconciliation state require a fresh baseline after the branch sync. Workspace deletion
also needs a recoverable customer-facing contract. The exact production cleanup may proceed before
that feature exists only through an audited one-time maintenance path that enforces the target and
preconditions above.
