# Docket

Manage work through Docket's MCP connection and help agents stay focused on the work they were asked
to finish. The plugin shares nine skills between Codex and Claude Code:

| Skill               | Use it for                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| `work-on`           | Start or resume substantive work from Docket at the assigned responsibility level. |
| `onboard`           | Review your workflow and choose how Docket will improve it.                        |
| `connect`           | Resolve account, authentication, and workspace access problems.                    |
| `capture-work`      | Capture or triage actionable tasks using workspace templates.                      |
| `plan-work`         | Shape projects, initiatives, programs, dependencies, and requested recurring work. |
| `update-work`       | Change work and record concise outcomes without polluting descriptions.            |
| `plan-day`          | Prioritize and schedule within commitments and the person's daily budget.          |
| `review-work`       | Review accomplishments, provenance, and incomplete source coverage.                |
| `get-back-on-track` | Re-anchor an agent in its assigned work at any level after a loop.                 |

`get-back-on-track` returns to the actual assigned Docket record, reads its scope and acceptance
criteria, and compares them with what the agent is doing. It interrupts repeated CI monitoring,
investigation, planning, retries, and redundant checks so the agent can finish that work. When access
is unavailable, a previously retrieved task snapshot can support provisional recovery, with its
unrefreshed status made explicit. It preserves useful running work and the user's authority.

## Git-backed development distribution

The maintained source is this product repository at `plugins/docket/`. The development distribution branch is `codex/docket-plugin-distribution`; access to the private repository is required. This is Git distribution, not an approved public marketplace listing.

```sh
codex plugin marketplace add git@github.com:TheHypertextStudio/athena-web.git --ref codex/docket-plugin-distribution --sparse .agents/plugins --sparse plugins/docket
codex plugin add docket@docket
claude plugin marketplace add git@github.com:TheHypertextStudio/athena-web.git#codex/docket-plugin-distribution
claude plugin install docket@docket
```

A release must be accepted against its exact Git revision and tested in the target host. Installation alone does not authenticate Docket or prove connected work. Follow the host's normal OAuth consent flow; never copy another session's credentials into a test installation.

## Install from this checkout

Run these commands from the repository root. No repository dependencies are needed to use the plugin.

### Codex

```sh
codex plugin marketplace add .
codex plugin add docket@docket
```

Open a new chat after enabling the plugin so its skills and server can load. If your desktop build
manages installation in its plugin settings, add this repository as a local marketplace there and
select **Docket**. The catalog lives at `.agents/plugins/marketplace.json`.

### Claude Code

```sh
claude plugin marketplace add .
claude plugin install docket@docket
```

For a temporary local preview without installing a marketplace:

```sh
claude --plugin-dir ./plugins/docket
```

Start a new session after installation. Use `/mcp` to connect the bundled Docket server. Skills are
available as `/docket:capture-work`, `/docket:plan-work`, and the other names above, and can also be
selected automatically when relevant.

### What changes when Docket is enabled

For substantive work, `work-on` tries to find the existing Docket task or project, even when the
latest prompt omits Docket. The agent explains the work reference, reads its requirements, verifies
the requested result, and records outcomes when the adopted workflow authorizes writes. You can
explicitly ask it to work outside Docket for an assignment. Ordinary questions do not require tasks;
missing access or an unmatched record does not obstruct independently scoped work.

An agent executes a task, coordinates a project's combined delivery, assesses an initiative's
strategic progress, or performs a program's assigned operating work. The assignment determines its
decision rights. Reading parent context does not authorize taking over that parent effort.
See [Agent assignments](references/agent-work.md) for the specific behavior and
[Subagents](references/subagents.md) for bounded handoffs, dependencies, shared changes, reporting
ownership, and combined acceptance. Host-local workers are not automatically registered Docket actors
or Athena sessions.

These defaults are skill instructions selected by the host, not a hook enforcing every conversation.
Onboarding explains the changes and can help save a requested convention in existing guidance.
Enabling the plugin does not itself create records, grant write/delegation authority, or schedule
background work.

### Fit Docket into your workflow

The [Docket Workflow](references/docket-workflow.md) defines the method: define the outcome, choose
the next work, do it, verify the result, and update the plan. Structure, cadence, and delegation
follow the work; projects, programs, and cycles are tools for applying the method.

Codex's setup action runs `onboard`. In Claude Code, invoke `/docket:onboard`; either host can also
select it for a relevant “help me get started” request. It helps fit Docket into the way you already
capture requests, choose priorities, work with agents, and review outcomes. It recommends a clear
default: relate substantive execution to existing tasks/projects, assign the responsibility level,
verify the result, and return authorized outcomes to the relevant records.
It explains the changes, asks you to adopt or adjust them, and tries them on a real task. The short
skill links to the workflow and relevant adoption guidance instead of loading every procedure at once.

Onboarding does not require a full workspace configuration or every provider connection. Existing
users can start with a project or assigned task; new users can capture real work or shape one
outcome. An access problem routes to `connect` and then returns to the chosen workflow. “Just fix
my connection” remains a focused repair. Resuming setup preserves completed steps and avoids duplicates.

For example, a signup repair starts from its task and verifies expired-link behavior. A project
coordinator checks that signup and orientation copy work together before closing the project.
Onboarding explains why this helps continuity and lets you adjust it. If another tracker already owns your work, it discusses
linking, sync, or import rather than imposing a second manual tracker. Any repository-guidance changes,
provider connections, or scheduled routines are separate deliberate choices.

### Connect your account

The bundled server is `https://api.clearthedocket.com/mcp`. Complete your host's OAuth consent flow
using your own Docket account. The plugin stores no tokens or API keys; the host manages credentials.
Your current scopes and workspace permissions determine which tools and work are available. The
first connection check reads visible workspaces without creating sample work.

If you already configured Docket as a standalone MCP connection, you can keep it while testing.
Choose which connection to use; remove a duplicate only deliberately. Do not copy credentials
between connections. If the connection is unavailable, `get-back-on-track` can use prior task context
provisionally; it cannot claim to have refreshed the current Docket record.

Try “Get back on track with the assigned Docket task,” “Capture this bug in our Platform project,”
or “Plan today with four work hours.” A request to inspect work does not silently authorize changes.

## Package and validation

The supported compatibility manifests are `.codex-plugin/plugin.json` and
`.claude-plugin/plugin.json`. Both reference one `.mcp.json` and one shared `skills/` tree. All
references stay inside the plugin. No hooks, local daemon, or install script runs with the package.

Validate Claude's package and repository marketplace from the repository root:

```sh
claude plugin validate --strict ./plugins/docket
claude plugin validate --strict .
```

After registering the local Codex marketplace, inspect its discovered entry:

```sh
codex plugin list --marketplace docket --available --json
```

Use [the behavioral scenarios](evals/scenarios.md) for opt-in skill evaluation. Package validation
establishes structure and discovery; it does not prove a fresh host's OAuth flow or live mutations.
Only read-only checks are needed during ordinary authoring. Test writes in a dedicated test workspace
with explicit authorization, then read results back. Do not use private task content as fixtures.

## Marketplace metadata

Both manifests include publisher contact, source and license identity, discovery keywords, product
documentation, support, privacy, and terms links. OpenAI also includes capability labels, starter
prompts, light/dark brand colors, composer/listing artwork, five positive and three negative MCP
review cases, commerce disclosure, and release notes. Anthropic's manifest includes its display name,
directory icon and URL fields; its catalog supplies publisher identity, tags, category, and defaults.
The OpenAI catalog keeps its supported source, policy, category, and display-name fields; listing
details live in the plugin manifest. Anthropic's plugin version is authoritative rather than copied
into the catalog entry.

`assets/logo.png` copies Docket's existing generated 512px icon, whose plate works in either theme.
`assets/task-detail.jpg` is the existing public marketing screenshot with sample account data; it
shows the Docket work surface, not an invented plugin chat or a newly verified host interaction.
Refresh these copies when the established source artwork changes. Dark brand color follows the
existing UI token. See [Attribution](NOTICE.md) for the recovery skill's upstream license.

The Anthropic directory fields require Claude Code 2.1.281 or later for strict validation. Earlier
hosts can load the skills but warn about those listing fields. Validate with a current CLI without
changing a globally installed version:

```sh
npx --yes @anthropic-ai/claude-code@latest plugin validate --strict ./plugins/docket
npx --yes @anthropic-ai/claude-code@latest plugin validate --strict .
```

No public listing is implied by the local marketplace. Initial MCP submission still needs a real
review walkthrough recording and a dedicated test account supplied through the secure review form;
neither belongs in source as a fabricated URL or credential. Assigned directory IDs, regional
targeting, and translated listings remain unset until those facts or choices exist. Account-specific
consent testing is also separate release evidence.

Host format references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
and [Claude Code plugin manifests](https://code.claude.com/docs/en/plugins-reference).

The recovery skill adapts the Studio's [CI Hell guidance](https://github.com/TheHypertextStudio/product-standards/tree/main/skills/ci-hell).
