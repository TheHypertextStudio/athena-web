# Docket documentation operations

Docket retains Mintlify for public guides, developer material, and the changelog. This adopts the
company web-docs operating/authoring templates without changing the application, backend,
authentication, customer data, native setup, provider project, or public URLs. The owning team is
Hypertext Studio; source lives in `TheHypertextStudio/athena-web`, `apps/docs`.

## Source and toolchain

| Item                     | Owner or pin                                                 |
| ------------------------ | ------------------------------------------------------------ |
| Product config           | `apps/docs/docs.site.json`                                   |
| Generated config         | `apps/docs/docs.json`; commit it with its source             |
| Content, assets, styling | Existing MDX, `logo/`, `style.css`                           |
| Shared config            | `@thehypertextstudio/web-config@0.1.0`; docs-only formatting |
| Shared docs              | `@thehypertextstudio/web-docs@0.1.0`                         |
| Native CLI               | `mint@4.2.854`                                               |
| Runtime                  | Node 24; local acceptance uses 24.20.0; pnpm 11.9.0          |
| Application setup        | Existing root `./bootstrap`; unchanged by the docs slice     |

The single root pnpm workspace/lock remains authoritative. Do not create a nested dependency
workspace or lock under `apps/docs`, install a global Mintlify CLI, or absorb native/backend
projects into another setup path. Use the scoped install and common commands in
[the docs README](../../apps/docs/README.md). Shared packages resolve through the committed scope
registry mapping; use company-managed read-only credentials outside the repository.

The Mintlify CLI omits its matching ReactDOM declaration, so `pnpm-workspace.yaml` supplies
`react-dom@19.2.3` only to `@mintlify/cli@4.0.1457`. Scarf telemetry and Puppeteer's separate browser
download are disabled; keytar's native binding is allowed. Existing application build policies,
including `sharp: false`, remain in force. Do not suppress peers or change application catalog
versions to repair a docs-only install.

### Source preparation and registry gate

The exact 0.1.0 packages are not yet published. Local acceptance uses an ignored override to the
reviewed package tarballs and a separate local validation lock; the committed monorepo lock is the
pre-adoption registry lock. No `file:` resolution is committed and no registry acceptance is claimed.
Before integrating this checkpoint into `main`, publish the reviewed immutable packages, grant
read-only access to this repository's CI, generate the real registry lock, and prove the scoped
frozen install from a clean checkout. CI's existing setup action must receive the scoped registry
and package-read authorization for all jobs that install the monorepo lock. Keep install credentials
inside the install step and out of logs. Rerun affected checks against that lock.

## Local preview and source checks

`pnpm docs:dev` serves the independent Mintlify preview at `http://localhost:3000`. Stop a competing
preview first; the shared wrapper currently supports the CLI's default port only.
Docs preview requires no database, authenticated application, provider API key, or deployment.
Mintlify may download its framework into the user's normal local cache; serialize CLI checks when
another company docs workspace shares that cache. The docs workspace scripts set
`DO_NOT_TRACK=1` for CLI preview/checks.

`pnpm docs:config:check` is a read-only configuration doctor. A stale file is repaired with
`pnpm docs:config`, followed by review of both configs. `pnpm docs:check` also runs native build,
local links with anchors/redirects/snippets, accessibility, product frontmatter/navigation/links,
config determinism, and the existing Docket vocabulary/OAuth/MCP coverage policy.

The existing CI Build job calls this one command instead of installing a global CLI and repeating
three native invocations. It adds no triggers or runners. A cold runner downloads one framework;
the existing cancellable validation runs the complete docs signal on each delivery. Other existing
release and coverage gates remain in place. `verify-docs.yml` separately probes public delivery
following application release and daily; it remains a post-deployment observation, with its existing
bounded retries and no new push multiplier.

## Provider and route contract

Provider observations from 2026-10-10 are recorded in
[docs-deployment.json](docs-deployment.json). They do not prove publication of this checkpoint.

| Setting                         | Recorded value                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Mintlify organization/project   | `hypertextstudio` / `docket`                                                          |
| Git integration                 | `TheHypertextStudio/athena-web`, branch `main`, directory `apps/docs`                 |
| Public origin/prefix            | `https://clearthedocket.com/docs`                                                     |
| Active source proxy origin      | `DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev`                                    |
| Dashboard upstream              | `https://docket.mintlify.site`; observation only, not a source replacement            |
| Dashboard Host-at               | `https://docket.hypertext.studio/docs`; stale canonical configuration                 |
| Last observed successful source | `0aadf2bd2669119ee8f99a1474e7fbac85273f57`, Oct 2, 2026, 5:05 PM dashboard display    |
| Contributor access              | Existing company Git/Mintlify access; no new account, credential, or role provisioned |
| Hosted previews                 | Unavailable after the Pro trial ended; use local preview                              |
| API deployment access           | Pro/Enterprise documented; no admin key created or plan changed                       |

Keep the current Vercel rewrite contract in `apps/web/next.config.ts`:

| Public source             | Active upstream destination                      |
| ------------------------- | ------------------------------------------------ |
| `/docs`                   | `${DOCS_MINTLIFY_ORIGIN}/docs`                   |
| `/docs/:path*`            | `${DOCS_MINTLIFY_ORIGIN}/docs/:path*`            |
| `/_mintlify/:path*`       | `${DOCS_MINTLIFY_ORIGIN}/_mintlify/:path*`       |
| `/mintlify-assets/:path+` | `${DOCS_MINTLIFY_ORIGIN}/mintlify-assets/:path+` |
| `/api/request`            | `${DOCS_MINTLIFY_ORIGIN}/_mintlify/api/request`  |

These asset/search/telemetry routes are part of delivery parity. The explicit upstream must never
be the public frontend origin or its redirecting Studio alias; that would recurse through the
same proxy. Keep the proven `.mintlify.dev` origin until a provider-approved replacement passes
all routes, content, assets, redirects, search, and forwarding behavior. Merely observing a different
dashboard hostname is insufficient. The API independently owns `https://api.clearthedocket.com/v1/docs`;
this slice does not proxy or migrate it.

### Canonical reconciliation

The application redirects the Studio alias to `clearthedocket.com`, and product config/links already
use the primary domain. Public docs currently render a canonical under the old Studio alias.
Mintlify's Host-at site address still names that alias. The pinned schema has page-specific canonical
frontmatter and arbitrary SEO meta tags; it has no global canonical-origin setting. Adding one
fixed canonical tag to every page would conflate different pages, and scattering 52 overrides would
leave provider-generated assets/sitemaps inconsistent. Retain content URLs and correct the provider
Host-at address to `https://clearthedocket.com/docs` during the separately reviewed provider phase.
Then verify each page's own canonical and `og:url`, the sitemap, aliases, redirects, search, and
assets through the same public prefix. This source checkpoint does not change that remote setting.

## Publishing and acceptance record

Publishing continues through the existing Mintlify Git integration after an authorized linear-history
push to `main`. There is no Workers artifact promotion for this Mintlify project. Before delivery,
record the reviewed source SHA, package versions, registry lock identity, generated-config identity,
local check results, and preview review. After publication, record the actual provider update
identity/status/source SHA and public observations in `docs-deployment.json`.

Verify `/docs`, a Guides page, a Developers page, Changelog, all six redirects, representative heading
anchors, logos/styles/client chunks/fonts, search and its request routes, `/docs/llms.txt`,
`/docs/llms-full.txt`, and the Scalar reference link. Check narrow layout and keyboard operation.
Run `pnpm launch:verify-docs` for the existing bounded public delivery probe, and perform canonical
and search checks it does not cover. A public HTTP 200 or the provider's old successful update is
insufficient evidence for the newly reviewed source. Keep source CI, local preview, provider
publication, public delivery, and application release results separate.

## Recovery and troubleshooting

- **Registry install fails:** confirm the exact versions were published and the company read-only
  access/CI package grant is configured. Do not substitute local paths into the committed lock.
- **Generated config is stale:** edit `docs.site.json`, regenerate, inspect the diff, commit both.
- **Native links/a11y fail:** fix the content, heading references, redirect, or alternative text;
  retain the additional product policy checks.
- **Local framework/keytar fails:** check the Node 24/pnpm pins and declared build approvals, then
  retry only the failed docs command. Do not repair the application database for a docs failure.
- **Public docs 502/404 or search fails:** inspect `DOCS_MINTLIFY_ORIGIN`, Mintlify update status,
  and every asset/search rewrite. The last incident showed source tests can pass with an invalid
  deployed upstream. Keep the active proven origin; do not guess an alias or recursive destination.
- **Canonical remains the old alias:** inspect the project's Host-at value and reconcile it with
  the primary public prefix; do not change every MDX page's URL.

Restore the last reviewed working config/content revision with the existing Git integration and
linear history. Revert product config, generated config, shared package pins, and the real registry
lock together if tooling caused the failure. Keep the matching active proxy configuration and
observe the resulting provider update and public routes. The recorded Oct 2 source is a provider
observation, not a certified rollback revision for this checkpoint; capture a complete known-working
revision and proxy settings before production integration. Never roll back customer data or the API
schema as part of docs recovery.
