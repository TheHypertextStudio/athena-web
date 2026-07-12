# Development Workflow

> **Version**: 1.0.1
> **Last Updated**: 2026-06-30

## Overview

This document describes the development workflow for Project Athena, including how to set up your environment, make changes, and contribute code.

## Getting Started

### Prerequisites

- Node.js 26 Current, or Node.js 24.15+ when staying on the 24 line
- pnpm 9.x
- PostgreSQL 16
- Git

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/hypertext-studio/athena-service.git
cd athena-service

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.local

# Set up database
pnpm db:push

# Start development servers
pnpm dev
```

### Environment Configuration

Create `.env.local` with required variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/athena

# Authentication
AUTH_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Stripe (optional for local dev)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Sentry (optional for local dev)
SENTRY_DSN=https://...
```

## Development Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `pnpm dev`           | Start all services in development mode |
| `pnpm build`         | Build all packages                     |
| `pnpm test`          | Run all tests                          |
| `pnpm test:watch`    | Run tests in watch mode                |
| `pnpm test:coverage` | Run tests with coverage                |
| `pnpm test:e2e`      | Run E2E tests                          |
| `pnpm lint`          | Run ESLint                             |
| `pnpm lint:fix`      | Fix linting issues                     |
| `pnpm typecheck`     | Run TypeScript type checking           |
| `pnpm format`        | Format code with Prettier              |
| `pnpm db:push`       | Push schema changes to database        |
| `pnpm db:generate`   | Generate migrations                    |
| `pnpm db:migrate`    | Run migrations                         |
| `pnpm db:studio`     | Open Drizzle Studio                    |

## Branch Strategy

### Branch Naming

```
main                           # Production-ready code
├── feature/<ticket>-<desc>    # New features
├── fix/<ticket>-<desc>        # Bug fixes
└── chore/<desc>               # Maintenance
```

**Examples:**

```
feature/AUTH-001-google-signin
fix/TASK-123-deadline-timezone
chore/update-dependencies
```

Branches are organized around product features and fixes, not engineering activity. Keep the
implementation, tests, documentation, migrations, and deployment changes for a product slice on
the same branch. Use `chore/` only for standalone maintenance that does not change product
behavior.

### Branch Rules

1. **Never commit directly to `main`**
2. **Create feature branches from `main`**
3. **Keep branches focused** - One feature/fix per branch
4. **Rebase before landing** - Keep history linear
5. **Never create merge commits** - `main` is linear-history only

### Linear History Only

Merge commits are not allowed on `main`.

Use one of these landing paths:

- `git merge --ff-only <branch>` when the branch is already ahead of `main`
- `git rebase main` on the branch, then fast-forward `main`
- `git cherry-pick <commit>` for one or more finished commits
- GitHub squash/rebase merge buttons, never the merge-commit button

Do not use:

- `git merge <branch>` when it would create a merge commit
- `git merge --no-ff`
- Pulls that create merge commits

This setup is automatic: `pnpm install` runs `scripts/install-git-guardrails.sh` via `prepare`.

The installer sets this repository-local Git config:

```bash
git config --local pull.ff only
git config --local pull.rebase true
git config --local branch.main.rebase true
git config --local branch.main.mergeOptions --ff-only
git config --local core.hooksPath "$(git rev-parse --git-common-dir)/docket-hooks"
```

The generated native Git hooks are:

- `pre-commit` - runs `pnpm lint-staged`
- `commit-msg` - runs `node scripts/validate-commit-message.mjs "$1"`
- `pre-merge-commit` - rejects merge commits before Git opens an editor
- `prepare-commit-msg` - blocks commits while `.git/MERGE_HEAD` exists

Do not add Husky for this. Native Git hooks are enough, and the installer makes them turnkey.

Required verification before saying work is landed:

```bash
git rev-list --merges --count origin/main..HEAD
```

The command must print `0`. If it does not, reset to the first parent before the merge and replay the intended commits with `git cherry-pick`.

## Making Changes

### 1. Create a Branch

```bash
# Ensure main is up to date
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/AUTH-001-google-signin
```

### 2. Make Changes

Follow these guidelines:

- Write tests first (TDD encouraged)
- Follow [Code Style Guide](./code-style.md)
- Keep commits atomic and focused
- Update documentation as needed

### 3. Commit Changes

Use [Conventional Commits](https://www.conventionalcommits.org/) with a message file so the body is
easy to write and review:

```bash
git commit -F /tmp/docket-commit-message.txt
```

Example message file:

```text
feat(auth): Add Google OAuth account linking

Connect authenticated users to Google Calendar through the integrations surface. The feature
includes provider configuration, callback handling, tests, and operator documentation so it can
be deployed and reviewed as one coherent product slice.
```

### Commit Message Format

```
<type>(<scope>): <description>

A substantive plain-language body that explains the change, its motivation,
and any important implementation or operational context.

[optional footer]
```

**Types:**
| Type | Description |
|------|-------------|
| `feat` | A new product capability or meaningful extension |
| `fix` | A correction to broken or incorrect behavior |
| `chore` | Standalone maintenance without product behavior changes |

**Scopes:**

Scopes are intentionally limited to product domains, high-level app features, and the `dx`
developer-experience domain.
The source of truth is the repo-wide `COMMIT_SCOPES.txt` file. Process scopes such as `ci`,
`deploy`, `deps`, `pnpm`, `release`, and `build` are not valid scopes unless they are deliberately
added to that file. For repo-wide maintenance, omit the scope.

These are the only allowed authored types. Documentation, tests, refactors, styles, build changes,
CI changes, and performance work belong in the `feat` or `fix` commit for the feature they support.
Use `chore` only when that work is standalone maintenance.

Example of a complete message file:

```text
fix(integrations): Preserve connector OAuth state

Retain the signed state value through the provider callback instead of reconstructing it from
request parameters. This closes an account-linking failure without changing the integration's
public contract.
```

The `commit-msg` hook enforces the `COMMIT_SCOPES.txt` allowlist for any scoped commit. It also
sentence-cases the commit description after the type/scope prefix and best-effort reflows body
paragraphs and list items to 72 columns. Long unbreakable tokens such as URLs, paths, and hashes are
preserved instead of rejected. Code fences, comments, trailers, and generated Git messages are left
alone. Every normal commit must use `feat`, `fix`, or `chore` and include a plain-language body with
at least 100 non-comment characters. The body may use ordinary Markdown paragraphs, lists, and
sections; no fixed heading template is required.

### 4. Run Validations

Before pushing, ensure all checks pass:

```bash
# Run all validations
pnpm typecheck
pnpm lint
pnpm test

# Or use the pre-push script
pnpm validate
```

### 5. Push and Create PR

```bash
# Push branch
git push -u origin feature/AUTH-001-google-signin

# Create PR via GitHub CLI or web interface
gh pr create --title "feat(auth): add Google OAuth sign-in flow" --body "..."
```

## Pull Request Process

### PR Template

```markdown
## Summary

Brief description of changes.

## Changes

- Added Google OAuth sign-in flow
- Implemented token refresh logic
- Added sign-in button to auth page

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Screenshots

(If UI changes)

## Checklist

- [ ] Code follows style guide
- [ ] Documentation updated
- [ ] Tests pass locally
- [ ] No new warnings
```

### Review Process

1. **Self-review** - Review your own changes first
2. **Request review** - Assign reviewers
3. **Address feedback** - Make requested changes
4. **Approval** - Get at least one approval
5. **Land** - Squash, rebase, cherry-pick, or fast-forward to `main`

### Merge Strategy

- **Squash** - For feature branches with multiple noisy commits
- **Rebase** - For small fixes and branches that should preserve individual commits
- **Fast-forward** - When `main` can advance directly to the branch tip
- **Cherry-pick** - When landing selected commits from another branch
- **Never** use merge commits

## Release Process

### Semantic Versioning

Releases follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0) - Breaking changes
- **MINOR** (0.1.0) - New features
- **PATCH** (0.0.1) - Bug fixes

### Automated Releases

Releases are automated via `semantic-release`:

1. Commits to `main` are analyzed
2. Version is determined from commit types
3. Changelog is generated
4. GitHub release is created
5. Packages are published (if applicable)

### Manual Release (if needed)

```bash
# Create release branch
git checkout -b release/v1.2.0

# Update version
pnpm version 1.2.0

# Push and create PR
git push -u origin release/v1.2.0
```

## Troubleshooting

### Common Issues

**pnpm install fails:**

```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules and reinstall
rm -rf node_modules
pnpm install
```

**TypeScript errors after pulling:**

```bash
# Regenerate types
pnpm typecheck
```

**Database connection issues:**

```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Reset database
pnpm db:push --force
```

**Tests failing unexpectedly:**

```bash
# Clear test cache
pnpm test --clearCache

# Run with verbose output
pnpm test --verbose
```

## Agent Workflow

For AI agents, follow the state machine defined in [AGENTS.md](../../AGENTS.md):

```
IDLE → PLANNING → RESEARCHING → IMPLEMENTING → VALIDATING → DOCUMENTING → COMMITTING → RETROSPECTING → IDLE
```

Key requirements:

1. Update WORKLOG.md before starting work
2. Plan before implementing non-trivial changes
3. Validate before committing
4. Document all changes
5. Never leave stubs or TODOs

---

_See also: [Code Style](./code-style.md), [Testing Strategy](../engineering/testing-strategy.md)_
