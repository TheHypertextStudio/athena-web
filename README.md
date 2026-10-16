# Docket

Daily planning opens from Today into its own activity at `/plan/day`. Its centered workspace keeps the agenda and editable work together without the application sidebar. Panel controls show Work, Agenda, or both. Leaving saves the draft and returns to Today. The agenda keeps work hours and all-day details behind disclosures while retaining scheduling conflicts and proposed changes.

Docket is a local-first workspace for planning and doing work. The repository contains the web
application, operator console, API, background runner, shared packages, and deployment tooling.

The public REST API accepts an optional exact `Docket-Version` assertion and identifies each
response with its contract and source revision. See the
[API version policy](docs/engineering/specs/api-version-policy.md) before changing the contract.
Comments and status updates include an `origin` that names a connected agent when it wrote the text.
The authorizing human remains in the audit record and is not shown as the author of that text.
Edited comments retain their original author and record the last editor separately.
An Athena turn assigned to an unavailable Lattice computer returns a `503` problem with code
`lattice_unavailable`; Docket keeps the chosen runtime and does not route the turn to a cloud model.
See the [Lattice model-routing specification](docs/engineering/specs/lattice-byo-model.md).

Athena keeps one conversation across visits. After six quiet hours, the panel opens on a fresh
view; the Earlier messages menu or an upward pull reveals the older stream. People can save a named
starting point on a message and finish that work at a later message. The same menu returns to saved
places. The app's search control finds exact Athena messages while the full conversation is open.
The full Athena page uses compact work navigation to open one review in that conversation. On a
phone, choosing work closes the picker and preserves the message draft. Native task comments show
the saved content and task link before approval, with the original request available separately.
While viewing a task, open Athena in the rail and choose **Work on this task** beside its message
composer to start a private assignment using the runtime selected in Settings. Enter an objective
and start work; any returned proposal waits for review before the task changes. If the selected
runtime is unavailable, the prompt retains the objective and links to Athena Settings for recovery.

Today opens a daily planning flow with an ordered schedule based on commitments, available work, events, and the time left in the workday. New suggestions must fit the remaining capacity. Calendar events marked free stay visible without blocking work. People can review earlier work, edit tasks and blocks, confirm the day, and start the next accepted task from Today. Drafts resume where they stopped, accepted changes retain earlier versions, and recorded time stays in the time ledger. Athena can assess the plan but is optional. The data and recovery rules are in [the daily planning engineering spec](docs/engineering/specs/daily-planning.md).

MCP agents creating tasks, projects, initiatives, or programs should generally discover a relevant
template through `list_templates`, read its literal Markdown body, and use that structure when
writing the work. The server supplies this guidance during initialization and in creation tool
contracts. Creation tools accept template references, copy omitted bodies and defaults, and return
the saved description for editing. When eligible saved templates exist, agents must select one
or supply `withoutTemplateReason` before creation. Explicit properties override defaults.
Catalog errors require `work:read` and return shared catalogs instead of repeating Markdown for
each item. Plan confirmation preserves applied template properties and explicit overrides.
See [template use over MCP](apps/docs/developers/mcp-tools-and-resources.mdx#create-work-from-a-template-body).

MCP clients can link project dependencies, related tasks, subtasks, initiative contributions, and
initiative hierarchy. Bulk updates can move tasks between cycles and change initiative membership.
Initiative-rooted plans show visible existing work, reject dependency cycles, and record added links
for undo. See the [MCP contract](docs/engineering/specs/mcp-surface.md) and
[planning canvas](docs/engineering/specs/planning-canvas.md).

An Initiative's Connected work tab groups projects inside their Programs, expands project details
on demand, and creates or links work without leaving the page. Quick-add keeps focus for the next
name and retains failed entries for retry. A Program's existing-project suggestions preserve that
Program's placement; the object's Move action handles placement changes.

Work templates has its own workspace destination at `/orgs/[orgId]/work-templates`, available
from workspace navigation. The library, gallery and saved-copy review share that full-page flow;
only authoring permissions remain in Settings. Each definition shows its purpose, included work and
next action. A live publication and its unpublished changes stay together; known unpublished linked
definitions appear before publication, with a direct return to the parent review. Old Settings
template links retain their destination, review section and focus when reopening here.

Work templates define the kinds of work an organization does. Their full-page editor separates
Purpose, Work, and Review: name the work, shape its starting outline and children, then review it
before sharing. Return to any section without starting over. Save draft keeps the definition private;
explicit publication creates an immutable workspace-visible version. Project repetition
shows its cadence controls in the setup step. Generated work opens its schedule and occurrence
history in a management overlay.
See [template and repeating-work setup](docs/core/work-template-ui.md) for the saved behavior and
draft boundaries. Every Initiative, Program, Project, and Task retains its chosen template and
published version, including work created by connectors or imports through a blank base template.
Work views filter and group by template. Creation reviews optional and nested child work before
saving the whole tree together, with a maximum of 500 new work items. Managed child dates follow
parent anchors and completion facts; explicit date edits, including clearing a date, stay manual.
Change template and Update template preview individually accepted starting fields, children, dates
and dependencies while preserving authored work. Save as template captures a private draft for
review before publication. Workspace administrators manage team offerings, authoring policy and
working weekdays. Archive review shows authorized parent-template and schedule usage; existing
accepted schedules continue to run from their retained versions.
Programs can own recurring Task or Project work with a title pattern, responsibility, calendar
rhythm and visible run history. Failed runs can be retried without creating duplicate work.
Missed runs awaiting a decision offer Create work for their original scheduled date.
A Program definition can include reusable routines; each new Program receives independent schedule
copies, and later definition edits leave existing copies intact. The authoring outline separates
included work from recurring work and keeps one editor in focus. Undoing Program creation ends its
unchanged installed routines while preserving already generated work and run history. See the
[Program schedule specification](docs/engineering/specs/work-template-schedules.md) for retained
history, private drafts and the staged legacy migration.
The Work templates workspace puts unfinished definitions and unpublished edits under Continue defining,
ahead of ready-to-use work. Required definitions stay beside the work that needs them; a published
version stays available while its next revision is being shaped. Choose starting work opens the
gallery by organizational context and outcomes. Review the real
included and recurring structure, make optional adjustments, then keep private drafts or explicitly
publish independent copies. Complete startup, nonprofit, agency and personal starting sets remain
available alongside smaller selections. Manual authoring and gallery use are available on every plan.
Saved copy reviews reopen current canonical drafts and show unpublished dependency pins honestly;
interrupted saves reconcile the original request instead of creating another bundle. Undo reverses the
aggregate copy while retaining later edits, used definitions and publication history. These interfaces
use `/templates/definitions/gallery` for discovery, checked preview and copy acceptance, with saved
bundle reentry and Undo under `/gallery/copies`. See the
[gallery specification](docs/engineering/specs/work-template-gallery-athena.md) for the separate
Athena, onboarding and cross-workspace delivery layers.
See the [identity engineering specification](docs/engineering/specs/work-template-identity.md) and
[blueprint specification](docs/engineering/specs/work-template-blueprints.md) for migration ordering,
private-draft preservation, transactional creation and REST/MCP compatibility.
For Codex connections that repeatedly request sign-in with several chats open, see
[refresh coordination troubleshooting](apps/docs/developers/connect-an-agent-mcp.mdx#codex-asks-you-to-reconnect-when-several-chats-are-open).

Android devices send selected notification captures and removals to the authenticated
`POST /v1/me/inbound` endpoint. Optional personal Athena review has its own server-recorded consent
and durable scheduled dispatch. See [personal inbound events](docs/engineering/specs/personal-inbound.md)
for schemas, settlement, lifecycle rules, and the dispatch kill switch.

## Public documentation

Public legal policies are served at `/terms` and `/privacy`; `/legal/history` links to complete
prior versions with navigation back to history and current policies. Official legal and privacy contacts stay separate from configured product support.
For a policy change, publish the linked documents first, then use the staff service-announcement
composer to prepare, review, and explicitly send the notice. Loading the October 2026 policy preset
only fills the composer, including its visible internal inbox destination; it does not create or
send an announcement. Review audience suppressions
and delivery results before treating notice as delivered.

Mintlify publishes `apps/docs` at [clearthedocket.com/docs](https://clearthedocket.com/docs).
The common root commands are `pnpm docs:config`, `pnpm docs:config:check`, `pnpm docs:dev`, and
`pnpm docs:check`. They use the pinned local CLI and shared company configuration while retaining
Docket’s content, appearance, vocabulary/OAuth/MCP coverage, and API-owned Scalar reference.

See [docs setup](apps/docs/README.md), [authoring](docs/engineering/docs-authoring.md), and
[configuration, publishing, and recovery](docs/engineering/docs-operations.md). Shared packages
`0.0.1` are published privately and this repository has Actions Read access. The genuine retained
registry lock passed native frozen installation and strict peers in run `38120984041`; source/build,
Workers runtime and exact-source provider acceptance remain required. Application/native/backend setup remains below.

## Frontend setup and Workers

Prepare a fresh checkout with the shared company worktree engine:

```sh
./bootstrap worktree prepare
```

The pinned engine reuses native dependency caches and keeps installed dependencies and mutable
outputs local to the checkout. `./bootstrap worktree check` and `./bootstrap worktree plan` inspect
setup without changing it. Use the existing `./bootstrap` for the backend development stack and
local application data.
The web workspace uses Next.js, OpenNext and Wrangler directly, with pinned dependencies and the
existing Turbo prerequisite graph:

```sh
pnpm exec turbo run build:worker --filter=@docket/web
pnpm --dir apps/web preview:worker --env staging
```

Supply reviewed public build inputs explicitly; the command does not load root `.env.local`.
For disposable local API/database/browser acceptance, the existing `pnpm test:release` supports
`RELEASE_WEB_RUNTIME=workers`. Supply `DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev`, matching
the existing core-screen CI setting, to include the documentation proxy in either runtime's checks.
See [Docket web setup](apps/web/README.md) and
[Workers compatibility](docs/engineering/workers-compatibility.md) for local isolation, native
staging commands and the required production approval. Vercel remains the active production host.
Ordinary CI and backend/native publication retain their existing triggers and mandatory checks;
there are no custom candidate/promote workflows or temporary publication-hold flags.

Private shared packages `0.0.1` remain in the genuine accepted registry lock. GitHub Actions installs
with its ephemeral `github.token` and package-read grants, not a classic personal token. The
maintained development-only Better Auth schema CLI is `auth@1.6.19`, matching the runtime;
`pnpm --filter @docket/auth exec auth generate` remains available with an explicit scratch
config/output. Native source checks do not establish Workers runtime, staging auth or provider
acceptance.

## From clone to a working app

On macOS or Linux, the supported entrypoint is:

```sh
./bootstrap
```

That one command checks the machine, installs the repository-pinned dependencies, reconciles the
safe local configuration, installs this repository's Git guardrails, migrates an embedded PGlite
database, proves passkey registration and returning-user sign-in against isolated temporary data,
and starts the development stack. It does not require Docker, a globally installed bootstrap tool,
provider accounts, or production credentials.

Bootstrap prints the web, API, and admin origins when the stack is ready. In a linked worktree it
prefixes each hostname with the branch name so worktrees do not steal one another's routes. Stop or
inspect the stack with:

```sh
./scripts/dev-stack.sh status
./scripts/dev-stack.sh stop
```

Rerun `./bootstrap` to repair drift. Existing valid configuration and generated secrets are
preserved; a healthy running stack is retained rather than restarted. The standard read-only and
production surfaces are:

```sh
./bootstrap check
./bootstrap plan local
./bootstrap verify local
./bootstrap plan production
./bootstrap production
```

Production changes require explicit approval and stop at provider or deployment boundaries that
cannot be verified. See [local development](docs/local-development.md), [deployment](docs/engineering/deployment.md),
and the [Hypertext Studio Repo Bootstrap Spec](docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md).

## Normal development

After bootstrap, use the printed web origin. If the stack was stopped, start it again with:

```sh
./scripts/dev-stack.sh start
eval "$(./scripts/dev-stack.sh env)"
```

Run repository checks with `pnpm check`. Package-specific commands remain available, but `./bootstrap`
is the required setup and recovery API.

## Search and Notion task imports

Search results show their entity type and linked provider. Inline `@` mentions retain every fetched
match, group matches by relevance, and include saved Library resources.

Generic Notion task imports require selected task databases in connection settings. An empty
selection pauses task imports. Docket-owned mirror databases and pages are excluded from generic
imports and writeback, including disabled mirrors. Typed Notion sync continues independently.

## People and workspace access

Docket records people independently from account access. Contributors can create a person while
assigning work or writing an @mention, including in personal workspaces. Creation sends no invitation.
Managers can link external identities and combine duplicate person records while preserving historical
references. The [People specification](docs/engineering/specs/people.md) defines these interactions and
their authorization and sync rules.

## Daily workload in MCP

`view_workload` opens a read-only daily workload App in an MCP Apps-capable host, with plans,
tracked utilization, capacity assumptions, and project/task/priority breakdowns. Its text and JSON
results also work in hosts without embedded Apps. See [calculation rules and local verification](docs/engineering/specs/daily-workload.md).
