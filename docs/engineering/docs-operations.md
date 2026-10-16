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
| Shared config            | `@thehypertextstudio/web-config@0.0.1`; docs-only formatting |
| Shared docs              | `@thehypertextstudio/web-docs@0.0.1`                         |
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

### Accepted registry lock and source checks

The exact 0.0.1 packages are published, this repository has GitHub Actions Read grants, and the
committed monorepo lock contains genuine registry resolutions. Native run
[38124448126](https://github.com/TheHypertextStudio/athena-web/actions/runs/38124448126) at
`c1bd43360609001ef866293a08f2fe890ff440cc` updated the retained production lock and passed
script-disabled frozen installation, strict peer validation and unchanged-source verification.
The adopted lock SHA256 is
`61493c19fdeec85f7205ba7a9c46afa53f6eefd7ded8f93386e241f0525ac510`; the private package
integrities match the reviewed published shipping bytes. Earlier ignored local-tarball checks
remain historical evidence, not the registry acceptance record.

Existing CI setup uses only the ephemeral `github.token` with `packages: read` through trusted
setup-node user configuration. Credentials are available only to installation and the temporary
user configuration is removed afterward. Do not create classic personal access tokens, transfer
browser/CLI credentials, or commit local package overrides.

Full CI [38126412295](https://github.com/TheHypertextStudio/athena-web/actions/runs/38126412295)
passed at `5bc5e81cdade1698d96e98751d3c289ee45de386`, including frozen installation and the
Build job's native docs build, links, accessibility and product coverage for 52 MDX pages.
The Mintlify config, MDX/assets, lock, workspace policy and `scripts/docs-check.ts` are unchanged
from that accepted source through `0819eede775db6a74efa111cc9d9ec2c3cdeea2a`. Generated config
SHA256 is `5d4f4c777ed996542545b7f83e5e0e2e6a76e639f7d89639151a6d5b1fe83f8b`.
This source acceptance does not establish Mintlify publication, provider canonical settings,
public delivery or observed recovery.

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

The table describes the current provider contract. The older
[docs-deployment.json](docs-deployment.json) is a historical snapshot; its pending gates and old
Host-at address do not describe the accepted Workers cutover. Keep current deployment receipts
and source/version evidence in private operational records.

| Setting                       | Recorded value                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Mintlify organization/project | `hypertextstudio` / `docket`                                                            |
| Git integration               | `TheHypertextStudio/athena-web`, branch `main`, directory `apps/docs`                   |
| Public origin/prefix          | `https://clearthedocket.com/docs`                                                       |
| Active source proxy origin    | `DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev`                                      |
| Dashboard upstream            | `https://docket.mintlify.site`; observation only, not a source replacement              |
| Dashboard Host-at             | `https://clearthedocket.com/docs`                                                       |
| Contributor access            | Existing company Git/Mintlify access; no new account, credential, or role provisioned   |
| Hosted previews               | Unavailable after the Pro trial ended; use local preview                                |
| API deployment access         | Entitlement unverified; existing Git publishing remains selected; no key or plan change |

Keep the current Next/OpenNext documentation proxy contract in `apps/web/next.config.ts`:

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

The application redirects the Studio alias to `clearthedocket.com`, and Mintlify's Host-at address
is `https://clearthedocket.com/docs`. After a provider address change, use the native Manual update
to rebuild generated canonical URLs. Verify each page's own canonical and `og:url`, the sitemap,
aliases, redirects, search and assets through the same public prefix. Keep the frontend's managed
Custom Domain: do not replace the apex with Mintlify's suggested CNAME when proxying only `/docs`.

The pinned schema has page-specific canonical frontmatter and arbitrary SEO meta tags, but no
global canonical-origin setting. Correct the provider address instead of adding a fixed canonical
to every page or scattering per-page overrides.

## Publishing and acceptance record

Publishing continues through the existing Mintlify Git integration after an authorized linear-history
push to `main`. There is no Workers artifact promotion for this Mintlify project. Before delivery,
retain the reviewed source and local/preview checks in private operational records. After
publication, retain the actual provider update status, source identity when exposed, and public
observations beside those records.

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
