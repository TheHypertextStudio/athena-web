# Complexity ratchet

Six ESLint rules cap how tangled a function may get and how large a file or function may grow. They
run wherever ESLint already runs: in editors, in the pre-commit hook (`lint-staged` runs
`eslint --max-warnings=0` on staged files), and in `pnpm lint`.

| Rule                           | Target |
| ------------------------------ | ------ |
| `complexity`                   | 12     |
| `sonarjs/cognitive-complexity` | 15     |
| `max-depth`                    | 4      |
| `max-params`                   | 5      |
| `max-lines`                    | 500    |
| `max-lines-per-function`       | 80     |

The two size rules skip blank lines and comments. Size is measured in code, not in prose: this
codebase writes long TSDoc deliberately, and a rule that counted it would push authors to explain
less in order to satisfy a number about length.

Size needs its own rules because the other four measure control-flow shape _inside_ one function and
say nothing about how much of it there is. Before these were added, a 3,000-line file of a hundred
simple functions scored perfectly, and the largest files in the repo had never failed a gate.

Cognitive complexity earns the one new plugin by weighting nesting and charging a nested closure to
the function that holds it, so it flags files no cyclomatic threshold reaches —
`packages/ui/src/components/views/flatten-groups.ts` scores 21 with nothing over the cyclomatic
target at all. Only that rule is enabled; the plugin's recommended preset carries roughly three
hundred, which is a different decision nobody has made.

## The ledger

Turning the rules on with no exceptions fails every file that already exceeded them, and a gate
that lands red gets disabled. `tooling/eslint-config/complexity-debt.json` records each such file's
current worst value per rule, and how many violations sit at it:

```json
{
  "apps/api/src/routes/object-commands.ts": {
    "complexity": { "max": 128, "count": 9 },
    "max-depth": { "max": 5, "count": 9 },
    "max-lines": { "max": 2516, "count": 1 },
    "max-lines-per-function": { "max": 711, "count": 7 },
    "max-params": { "max": 7, "count": 4 },
    "sonarjs/cognitive-complexity": { "max": 341, "count": 8 }
  }
}
```

`complexityDebtConfig` in `tooling/eslint-config/index.js` turns the `max` values into per-file rule
overrides, appended last in `eslint.config.js` so the relaxations win. A ledgered file's worst
function cannot get worse; every other file is held to the target.

### Why the count exists

The pin is per file, not per function, and on its own that was a hole wide enough to drive the
codebase through. A brand-new 40-branch function added to a file ledgered at `complexity: 52` lints
clean, because the file's ceiling already allows it — ESLint emits no message, so no new ledger
entry is needed and the `AGENTS.md` rule against adding entries never fires either. The effect was
backwards: the several hundred gnarliest files in the repo were the cheapest places to add
complexity, and the gate was strictest on the files that were already fine.

`count` closes it. `pnpm complexity:check` re-measures the tree against the _targets_ rather than
the relaxations, and fails when a file's worst value rises **or** when the number of violations at
its ceiling rises. It runs as part of `pnpm lint`, so it is enforced wherever lint is.

ESLint cannot express "at most N violations in this file", which is why this one gate does live
outside ESLint. Regenerating the ledger to absorb a regression is the one forbidden way to make it
green.

A ratchet, not a target: **the numbers may only ever be lowered.** Refactor, then

```bash
pnpm complexity:ledger
```

which rewrites the file from a measurement (`scripts/complexity-ledger.ts`). Nothing can raise a
number behind your back: a change that pushes a clean file over the target fails `eslint`, and one
that grows an already-ledgered file fails `pnpm complexity:check`. Adding a _new_ entry, a larger
`max`, or a larger `count` for code you just wrote defeats the gate; refactor instead. Sign-off is
an empty ledger:

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

1,355 files, 2,153 entries at the time of writing — the numbers `pnpm complexity:ledger` prints, so
a regeneration that disagrees means the tree moved, not that the doc is stale. The jump from 499
files is the two size rules arriving: 247 files are over the 500-line target and 1,154 hold a
function over 80 lines, neither of which anything measured before. The largest single wins:

| File                                                                                          | complexity / cognitive |
| --------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/api/src/routes/object-commands.ts`                                                      | 128 / 341              |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx`          | 127 / 77               |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx` | 111 / 59               |
| `scripts/integrations-setup.ts`                                                               | 96 / 165               |
| `apps/api/src/routes/notion-mirror-reconcile.ts`                                              | 68 / 133               |

`packages/env`, `packages/auth`, `the deleted legacy type warehouse` and `domains/connections` carry only a handful
each and are the natural first trees to clear.
