# /docs

Bring documentation in line with what the code actually does, per `AGENTS.md` → Documentation Requirements.

## Usage

```
/docs                   # find undocumented exports and stale docs across the repo
/docs api               # check the OpenAPI/Scalar surface for apps/api
/docs <file-path>       # document one file or module
/docs check             # verify only, report gaps without editing
```

## What "documented" means here

Per AGENTS.md, every exported function, class, and type needs TSDoc: a one-line summary, `@param`/`@returns` for anything not obvious from the signature, and `@throws` when a call can throw. Do not add `@example` or `@remarks` blocks that just restate the code below them — AGENTS.md calls those out explicitly as skippable, and padding an export with them isn't diligence, it's noise a reviewer has to read past.

## Actions

### No argument: repo-wide audit

1. `pnpm typecheck` first — an export with a broken type signature isn't worth documenting yet.
2. Grep for exported functions, classes, and types missing a `/** */` block immediately above them across `apps/api/src`, `apps/web/src`, and `packages/*/src`.
3. Report gaps grouped by package, not as one flat list — `packages/shared` and `apps/web` get reviewed by different people.

### `api`: the Hono/OpenAPI surface

1. Confirm every route in `apps/api` carries an OpenAPI annotation (AGENTS.md's Hono Backend Patterns require this on all routes).
2. Cross-check against the Scalar-rendered output rather than trusting the annotation alone — a schema that doesn't match its Zod validator will still render, and render wrong.

### A specific file or module

1. Add TSDoc to its exports following the standard above.
2. Update the module's README only if the change touched a documented feature, API surface, or setup step — don't pad it to look thorough.

### `check`

1. Verify every export has TSDoc.
2. Check that Markdown links inside `docs/` resolve to real files — a moved or renamed doc breaks these silently.
3. Report findings without editing anything.

## Notes

A `/docs` pass on its own rarely counts as "significant work" needing its own `docs/WORKLOG.md` entry. If it's part of a larger task, fold the documentation changes into that task's existing entry instead of creating a second one.
