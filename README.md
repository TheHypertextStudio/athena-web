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

Android devices send selected notification captures and removals to the authenticated
`POST /v1/me/inbound` endpoint. Optional personal Athena review has its own server-recorded consent
and durable scheduled dispatch. See [personal inbound events](docs/engineering/specs/personal-inbound.md)
for schemas, settlement, lifecycle rules, and the dispatch kill switch.

## Public documentation

Mintlify publishes `apps/docs` at [clearthedocket.com/docs](https://clearthedocket.com/docs).
The common root commands are `pnpm docs:config`, `pnpm docs:config:check`, `pnpm docs:dev`, and
`pnpm docs:check`. They use the pinned local CLI and shared company configuration while retaining
Docket’s content, appearance, vocabulary/OAuth/MCP coverage, and API-owned Scalar reference.

See [docs setup](apps/docs/README.md), [authoring](docs/engineering/docs-authoring.md), and
[configuration, publishing, and recovery](docs/engineering/docs-operations.md). Shared packages
`0.0.1` are published privately and this repository has Actions Read access. A real product registry
lock and exact-source provider acceptance remain required. Application/native/backend setup remains below.

## Frontend standardization

The company frontend lifecycle is available through `./run setup`, `./run doctor`, `./run check`,
`./run dev` and `./run build`. Its declaration and shared pins live in `apps/web`; the existing
`./bootstrap` remains the owner of the full backend development stack and application data.
See [Docket web setup](apps/web/README.md) and the [Workers compatibility checkpoint](docs/engineering/workers-compatibility.md).
Vercel remains active while native Proxy compatibility, package registry and provider/auth gates
are unresolved.

Maintainers can explicitly dispatch the existing **Verify docs** workflow on
`codex/docket-workers-compat` with `refresh_dependency_lock=true` to propose a fresh registry lock.
It uses exact Node 24.20.0/pnpm 11.9.0 and the repository's short-lived GitHub token, disables install
scripts, replays the frozen install, checks peers, and uploads only the proposed lock and its source/run
provenance for seven days. It makes no documentation probes or deployments. Review the entire lock
diff before adopting it; this job does not update source. A failed validation still retains the new
lock with actual step outcomes and `accepted: false`; the workflow remains red. The only new release-age exceptions are exact
`@thehypertextstudio/web-config@0.0.1` and `@thehypertextstudio/web-docs@0.0.1`, the two consumed packages
from approved candidate `38116243716-1`. Other existing age policy and build approvals are preserved.

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
