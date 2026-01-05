# Development Workflow

> **Version**: 1.0.0
> **Last Updated**: 2026-01-04

## Overview

This document describes the development workflow for Project Athena, including how to set up your environment, make changes, and contribute code.

## Getting Started

### Prerequisites

- Node.js 20 LTS
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

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in development mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm format` | Format code with Prettier |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:generate` | Generate migrations |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Branch Strategy

### Branch Naming

```
main                           # Production-ready code
├── feature/<ticket>-<desc>    # New features
├── fix/<ticket>-<desc>        # Bug fixes
├── docs/<desc>                # Documentation
├── refactor/<desc>            # Code restructuring
└── chore/<desc>               # Maintenance
```

**Examples:**
```
feature/AUTH-001-google-signin
fix/TASK-123-deadline-timezone
docs/api-authentication
refactor/task-service-cleanup
chore/update-dependencies
```

### Branch Rules

1. **Never commit directly to `main`**
2. **Create feature branches from `main`**
3. **Keep branches focused** - One feature/fix per branch
4. **Rebase before merging** - Keep history clean

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

Use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Good commit messages
git commit -m "feat(auth): add Google OAuth sign-in flow"
git commit -m "fix(calendar): resolve timezone offset in event display"
git commit -m "docs(api): document authentication endpoints"
git commit -m "test(tasks): add unit tests for priority calculation"

# Bad commit messages
git commit -m "fix bug"
git commit -m "WIP"
git commit -m "changes"
```

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting |
| `refactor` | Code restructuring |
| `perf` | Performance |
| `test` | Tests |
| `chore` | Maintenance |
| `ci` | CI/CD |

**Scopes:**
- `api` - Backend API
- `web` - Frontend
- `auth` - Authentication
- `calendar` - Calendar features
- `tasks` - Task management
- `db` - Database
- `ci` - CI/CD

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
5. **Merge** - Squash and merge to main

### Merge Strategy

- **Squash merge** - For feature branches
- **Rebase merge** - For small fixes
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

*See also: [Code Style](./code-style.md), [Testing Strategy](../engineering/testing-strategy.md)*
