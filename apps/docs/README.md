# `@docket/docs` — the public documentation site

Mintlify renders this MDX and serves it at
[`docket.hypertext.studio/docs`](https://docket.hypertext.studio/docs). Mintlify deploys the
directory after a push to `main`.

## Working on the site

Install Mintlify's `mint` CLI, then run `mint dev` from this directory. Before you commit, run
`pnpm docs:check` from the repository root. CI also runs `mint validate`, the full internal link
check, and `mint a11y`.

## What keeps these pages honest

`pnpm docs:check` fails on missing navigation pages, orphan pages, weak frontmatter, broken local
links and anchors, the wrong primary domain, or demo fixture copy. The docs policy suite also fails
when the product adds a vocabulary key, MCP tool, or OAuth scope without updating its public
coverage.

Every `feat` and `fix` commit must end with a `Docs-impact` trailer. Use `Updated - <page>` when the
guide changed. Use `Not needed - <reason>` when the behavior does not affect public guidance.

## What lives here, and what does not

This site is the **higher-level** reference. The endpoint-by-endpoint REST reference stays at
`/v1/docs`, generated from the running API by Scalar, and `developers/rest-api.mdx` links into it
rather than restating it. Nothing here is generated from the OpenAPI document.

`docs/` at the repository root contains internal engineering material. Mintlify does not publish
it.
