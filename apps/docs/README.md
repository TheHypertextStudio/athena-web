# `@docket/docs` — the public documentation site

MDX content rendered by [Mintlify](https://mintlify.com) and served at `/docs` on the web app's
origin. Mintlify's GitHub App builds this directory on push to `main`; there is no GitHub Actions
workflow and no build step in this repository.

## Why this package declares no scripts

`package.json` here has no `lint`, `typecheck`, `test`, or `build` entry, and that is deliberate.
Turbo only runs a task in packages that declare it, so an MDX-only package stays invisible to
every root gate rather than needing to be excluded from each one. `tooling/eslint-config` and
`tooling/tsconfig` set the same precedent.

Two consequences worth knowing before you add a file:

- **Write pages as `.mdx`, never `.md`.** The root `format:check` gate — which runs inside CI's
  `typecheck` job — globs `**/*.{ts,tsx,md,json}`. A `.md` page here would be Prettier-enforced
  and would fight Mintlify's own formatting. `.mdx` is outside that glob.
- **`docs.json` is in `.prettierignore`.** Mintlify rewrites and reorders it, the same way
  `packages/db/drizzle/meta/` is machine-owned.

## Working on the site

```sh
cd apps/docs && npx mint dev
```

Then `npx mint broken-links` before opening a PR.

## What keeps these pages honest

`packages/test-utils/tests/docs-policies/docs-coverage.test.ts` runs in the gating `test` job and
fails when the product grows something these pages do not mention: a new vocabulary key, a new MCP
tool, a new OAuth scope, or a `docs.json` navigation entry with no file behind it. It exists
because `docs/engineering/mcp-access.md` claimed 15 MCP tools for long enough that two other
documents copied the wrong number.

## What lives here, and what does not

This site is the **higher-level** reference. The endpoint-by-endpoint REST reference stays at
`/v1/docs`, generated from the running API by Scalar, and `developers/rest-api.mdx` links into it
rather than restating it. Nothing here is generated from the OpenAPI document.

`docs/` at the repository root is internal engineering material and is **not** published.
