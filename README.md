# Docket

Docket is a local-first workspace for planning and doing work. The repository contains the web
application, operator console, API, background runner, shared packages, and deployment tooling.

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
