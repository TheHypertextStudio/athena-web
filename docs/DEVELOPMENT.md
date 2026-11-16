# Development

## Quickstart

Installing dependencies needs read access to the Studio's private `@thehypertextstudio` packages (`web-config`, `format-config` and `web-docs`, which supply the shared lint, format and TypeScript settings and the docs generator). Maintainers have it; without it, `pnpm install` stops with an authorization error. An outside contributor can still propose a change: open a pull request, and its checks install, test and build it.

The toolchain is Node.js 24 (`.nvmrc`; `engines` accepts 24.15 up to 26) and pnpm 11.9.0 (`packageManager` in `package.json`, activated by Corepack). The default database is embedded PGlite, so no database server is needed.

With package access, a fresh clone builds and tests with:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm lint` also runs the complexity check, and `pnpm test` runs every package's tests with coverage plus the repository tooling tests. `pnpm build` builds every app and package. After a build, `pnpm dev` starts the local stack with the safe defaults in the committed `.env.local`.

[Local development](local-development.md) describes the full setup, the development stack and the version-control hooks. [Development workflow](contributing/workflow.md) and [code style](contributing/code-style.md) describe how changes are made.
