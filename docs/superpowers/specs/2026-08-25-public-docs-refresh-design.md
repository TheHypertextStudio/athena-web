# Public documentation refresh

Docket maintainers must leave this work with a public guide that matches deployed production and a
repeatable account of how they proved each claim. The site will follow Linear's usage-documentation
pattern: one feature per page, a short overview, action-based sections, exact product labels, useful
shortcuts, selective screenshots, and real edge cases.

## Production is the source of truth

The public site will describe behavior that works on `docket.hypertext.studio` with the deployed API.
The implementation will record the web deployment commit, the latest successful API deployment, the
live OpenAPI shape, and any relevant feature flags before it edits prose. A merged feature that does
not work through that deployed stack stays out of the guide.

The verified starting point on 2026-08-25 is split. Vercel serves web commit `19c1c325`. GitHub's
latest successful production deployment is `3a0b0d98`. The live API exposes 368 OpenAPI paths. The
current source exposes two additional task-expansion paths, so those unreleased operations must not
appear in this refresh.

## Information architecture

The site keeps the Guides, Developers, and Changelog tabs. Guides will contain Getting started,
Daily work, Core concepts, Managing Docket, and Athena. Existing URLs stay valid. Eight new pages
will cover Tasks and Triage, Library, Graph, workspace access, workflow configuration, connections
and imports, templates with automations and publishing, and personal account settings.

The existing concept and daily-use pages will absorb behavior that belongs there. Today will explain
Agenda. Time will explain Focus and the personal review ledger. Inbox will explain Stream. Calendar
will explain work locations. Search will explain typed Views and roster controls. Project and
Initiative pages will explain broad planning periods. Program pages will explain activity summaries.

Scalar remains the endpoint reference. Mintlify will explain how to authenticate, connect an agent,
choose a tool, and handle stable errors without copying endpoint schemas.

## Writing and visual evidence

Each page will open with the answer or action. The prose will use current Docket labels and ordinary
sentences. It will not identify a persona, announce an audience, restate navigation, or turn commit
subjects into product copy.

A dedicated `Docket Documentation Demo` workspace will contain synthetic work. Six screenshots will
show Today with Agenda, Calendar with work locations, Time review, Views, Library, and Graph. The
images will omit account identifiers and use consistent example work across the guides.

## Publication

The refresh will pass the existing documentation-policy tests and Mintlify's broken-link check. A
local review will cover desktop and phone widths in both themes. After the branch reaches `main`, the
live review will check navigation, search, assets, `llms.txt`, `llms-full.txt`, and every illustrated
journey. If production changes during the audit, the writer will reconcile that delta before the
site publishes.
