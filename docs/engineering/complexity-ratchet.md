# Complexity ratchet

Four ESLint rules cap how tangled a function may get. They run wherever ESLint already runs: in
editors, in the pre-commit hook (`lint-staged` runs `eslint --max-warnings=0` on staged files), and
in `pnpm lint`. There is no separate checker, CI job, or gate to keep in sync.

| Rule                           | Target |
| ------------------------------ | ------ |
| `complexity`                   | 12     |
| `sonarjs/cognitive-complexity` | 15     |
| `max-depth`                    | 4      |
| `max-params`                   | 5      |

Cognitive complexity earns the one new plugin by weighting nesting and charging a nested closure to
the function that holds it, so it flags files no cyclomatic threshold reaches —
`packages/ui/src/components/views/flatten-groups.ts` scores 21 with nothing over the cyclomatic
target at all. Only that rule is enabled; the plugin's recommended preset carries roughly three
hundred, which is a different decision nobody has made.

## The ledger

Turning the rules on with no exceptions fails every file that already exceeded them, and a gate
that lands red gets disabled. `tooling/eslint-config/complexity-debt.json` records each such file's
current worst value per rule:

```json
{
  "apps/api/src/routes/object-commands.ts": {
    "complexity": 128,
    "max-depth": 5,
    "max-params": 7,
    "sonarjs/cognitive-complexity": 341
  }
}
```

`complexityDebtConfig` in `tooling/eslint-config/index.js` turns that into per-file rule overrides,
appended last in `eslint.config.js` so the relaxations win. A ledgered file's worst function cannot
get worse; every other file is held to the target.

**The pin is per file, not per function, and that is a real hole.** A brand-new 40-branch function
added to a file ledgered at `complexity: 52` lints clean, because the file's ceiling already allows
it — no new ledger entry is needed, so the `AGENTS.md` rule against adding entries never fires
either. 499 of ~3,400 tracked TypeScript files are exempt this way, and the two files the table
below calls the worst offenders are consequently the two cheapest places in the repo to add a
complex function. Closing it means keying the exemption to the function rather than the file (a
ledger of function names, or generated `eslint-disable-next-line` comments); until then the gate's
real guarantee is "no ledgered file gets worse than its worst function today", not "no function
above target gets written".

A ratchet, not a target: **the numbers may only ever be lowered.** Refactor, then

```bash
pnpm complexity:ledger
```

which rewrites the file from a measurement (`scripts/complexity-ledger.ts`). Nothing can raise a
number behind your back — a change that made a file worse fails `eslint` at the commit that
introduces it, before it could reach the script. Adding a _new_ entry for code you just wrote
defeats the gate; refactor instead. Sign-off is an empty ledger:

```bash
jq 'to_entries | length' tooling/eslint-config/complexity-debt.json
```

## Two things that will bite whoever touches this next

**Ledgered paths are escaped before they reach a `files` pattern.** Many files here carry a Next.js
dynamic segment. Unescaped, `orgs/[id]/page.tsx` is a character class: it matches `orgs/i/page.tsx`
and never the file itself, so the relaxation lands on nothing while the real file fails at the
target.

**`Linter`'s `cwd` is pinned to the repo root in the script.** `Linter` relativizes each file path
against its `cwd` before matching `files` patterns. Left at the process default, running from
anywhere but the root matches nothing and the scan reports a clean tree — a silent zero, not an
error.

`turbo.json` names `eslint.config.js` in `lint`'s `inputs` because that file sits at the repo root
and belongs to no package, so nothing else hashes it. Everything inside `tooling/eslint-config/` —
`index.js`, `plugin.js`, `rules/**`, and `complexity-debt.json` — is already hashed through the
workspace dependency graph, since every linted package declares `@docket/eslint-config` as a
dependency. Verified: touching `rules/no-bespoke-overlay.js`, which is named in no `inputs` entry,
changes both `@docket/ui#lint` and `the retired contract package#lint` hashes.

## Where the debt is

499 files, 772 entries at the time of writing — the numbers `pnpm complexity:ledger` prints, so a
regeneration that disagrees means the tree moved, not that the doc is stale. The largest single
wins:

| File                                                                                          | complexity / cognitive |
| --------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/api/src/routes/object-commands.ts`                                                      | 128 / 341              |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`          | 127 / 77               |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx` | 111 / 59               |
| `scripts/integrations-setup.ts`                                                               | 96 / 165               |
| `apps/api/src/routes/notion-mirror-reconcile.ts`                                              | 68 / 133               |

`packages/env`, `packages/auth`, `the deleted legacy type warehouse` and `domains/connections` carry only a handful
each and are the natural first trees to clear.
