# Docket public documentation

Mintlify renders this directory at [clearthedocket.com/docs](https://clearthedocket.com/docs).
The existing `docket` project publishes `apps/docs` from `TheHypertextStudio/athena-web`, branch
`main`. The web application currently serves the docs through its Vercel rewrite. The running
API owns the separate [Scalar reference](https://api.clearthedocket.com/v1/docs).

## Setup and commands

Use Node 24 (validated with 24.20.0), pnpm 11.9.0, and company-managed read-only GitHub Packages
access. From the repository root, install only the docs/tooling dependency graph:

```sh
pnpm install --filter @docket/root... --filter @docket/docs --frozen-lockfile
pnpm docs:config:check
```

The exact shared 0.0.1 packages are published and the genuine registry lock is adopted.
Repository GitHub Actions Read grants and the ephemeral `github.token` provide CI package access;
no personal access token is required. Native run
[38124448126](https://github.com/TheHypertextStudio/athena-web/actions/runs/38124448126)
passed retained-lock resolution, script-disabled frozen installation and strict peer validation.
CI [38126412295](https://github.com/TheHypertextStudio/athena-web/actions/runs/38126412295)
then passed the native docs build, links, accessibility and product checks for all 52 MDX pages.
See [the operating reference](../../docs/engineering/docs-operations.md) for exact source and lock
identities. Integration into the publishing branch, source-bound Mintlify publication, canonical
reconciliation and public delivery/recovery acceptance remain separate gates.

| Root command             | Purpose                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm docs:config`       | Generate committed `docs.json` from product-owned `docs.site.json`.                              |
| `pnpm docs:config:check` | Fail on generated-file drift without writing.                                                    |
| `pnpm docs:dev`          | Start the pinned local Mintlify preview at `http://localhost:3000`.                              |
| `pnpm docs:check`        | Check drift, native build, links/anchors/redirects/snippets, accessibility, and Docket coverage. |

The local CLI is exactly `mint@4.2.854`, called through `@thehypertextstudio/web-docs@0.0.1`.
Use these commands without a global Mintlify installation. Docs setup and preview do not require
an application account, database, Stripe, or cloud provisioning. The full application keeps its
existing `./bootstrap` setup; this docs slice does not replace it.

## Authoring and configuration

Edit MDX, images, and `docs.site.json`; regenerate and commit `docs.json` with its source.
Keep the Maple theme, Fraunces headings, IBM Plex Sans body, approved palette, logos, navigation,
redirects, public URLs, and heading anchors. Shared formatting comes from
`@thehypertextstudio/web-config@0.0.1` in `prettier.config.mjs` and is scoped to this workspace.

See [authoring](../../docs/engineering/docs-authoring.md) for content review and
[operations](../../docs/engineering/docs-operations.md) for environment, publishing, canonical
reconciliation, troubleshooting, and recovery. Internal engineering material under root `docs/`
is outside the published navigation.
