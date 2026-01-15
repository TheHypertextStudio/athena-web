---
description: Run typecheck, lint, and tests to verify code quality. Use before committing changes, after making edits, or when asked to validate or check the code.
argument-hint:
---

# Validate

Run all validation checks before committing.

## Description

Executes the full validation suite: type checking, linting, and tests. This ensures code is ready for commit.

## Usage

```
/prompts:validate
```

## Actions

1. Run TypeScript type checking (`pnpm typecheck`)
2. Run ESLint (`pnpm lint`)
3. Run tests with coverage (`pnpm test:coverage`)
4. Report any failures with details

## Expected Behavior

- If all checks pass, report success
- If any check fails, report the specific failures and do NOT proceed with commits
- Coverage must meet 80% threshold

## Exit Criteria

All validations must pass before considering work ready to commit.
