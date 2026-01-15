---
description: Generate or update documentation for code, APIs, or modules. Use when adding TSDoc comments, updating API docs, or checking documentation coverage.
argument-hint: [TARGET=<api|file-path|check>]
---

# Documentation

Generate or update documentation.

## Description

Create or update documentation for code, APIs, or processes. Ensures documentation stays in sync with implementation.

## Usage

```
/prompts:docs                      # Analyze what needs documentation
/prompts:docs TARGET=api           # Update API documentation
/prompts:docs TARGET=src/lib/foo   # Document specific file/module
/prompts:docs TARGET=check         # Verify documentation completeness
```

## Actions

When `$TARGET` is provided, perform the corresponding action below. Otherwise, run Analyze.

### Analyze

1. Scan codebase for undocumented exports
2. Check for outdated documentation
3. Report documentation gaps

### API Documentation

1. Ensure OpenAPI specs are complete
2. Verify Scalar documentation is accurate
3. Check for missing endpoint documentation

### File/Module Documentation

1. Add TSDoc comments to exported items
2. Create/update module README if needed
3. Ensure examples are current

### Check

1. Verify all exports have TSDoc
2. Check documentation links are valid
3. Ensure README files are current

## TSDoc Template

````typescript
/**
 * Brief description.
 *
 * @remarks
 * Additional context.
 *
 * @param paramName - Description
 * @returns Description
 *
 * @example
 * ```typescript
 * // Usage example
 * ```
 */
````

## Notes

- Documentation is REQUIRED, not optional (per AGENTS.md)
- Update documentation when changing code
- Keep examples up to date
