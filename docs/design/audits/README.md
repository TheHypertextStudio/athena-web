# Craft scorecards

Every `.md` file **directly in** this directory is one Craft Rubric review of one or more surfaces.
The prose body is written for humans and follows the format in
[`../craft-rubric.md`](../craft-rubric.md). The `---` block at the top of each file is written for
machines.

Subdirectories are not scorecards and are not read as such. `listScorecardFiles` filters on
`entry.isFile()`, so anything nested is skipped — `screenshots/` holds captured evidence, and
`security/` holds audits that are graded against a launch requirement rather than the eight craft
dimensions (scoring craft on a security sweep would be inventing numbers). **Depth is the only
thing separating a scorecard from a skipped file**, so a review meant to be counted must sit
directly here; one filed a level down is silently invisible to both policy tests.

That header exists for one reason. **GEN-10** — the launch requirement that no surface ships in a
knowingly degraded state — is only checkable if "how many surfaces have a passing scorecard" is a
number a test can compute. Ten documents of careful prose cannot be counted. A header can.

Two policy tests read this directory:

- [`packages/test-utils/tests/design-policies/scorecard-schema.test.ts`](../../../packages/test-utils/tests/design-policies/scorecard-schema.test.ts)
  validates every header in this directory.
- [`packages/test-utils/tests/design-policies/surface-inventory.test.ts`](../../../packages/test-utils/tests/design-policies/surface-inventory.test.ts)
  keeps [`../surface-inventory.md`](../surface-inventory.md) current with the source tree.

---

## The header

```markdown
---
surfaces: ['settings-athena', 'settings-connections']
date: 2026-07-19
verdict: ship
scores:
  brand: 3
  typography: 3
  spacing: 4
  hierarchy: 3
  color: 4
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---
```

It must be the very first thing in the file, opened and closed by a line containing exactly `---`.

### `surfaces`

An inline array of surface ids, at least one. Every id must appear in the Surface id column of
[`../surface-inventory.md`](../surface-inventory.md), which is generated from the source tree — so
an id here is a claim about a surface that provably exists, not a label someone invented.

Ids are quoted because a route with a dynamic segment contains square brackets
(`'orgs-[orgId]-my-work'`), and an unquoted bracket inside a YAML flow sequence is a syntax error.
Quote all of them, including the ones that would parse bare, so the file reads consistently.

Prettier rewraps a long array across several lines with a trailing comma. That is fine — the reader
accepts both the one-line and the wrapped form. Do not undo it.

### `date`

The review date, `YYYY-MM-DD`. Matches the date in the file name and the H1.

### `verdict`

One of:

| Value        | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `ship`       | This surface met the bar at review time: five green gates, every dimension ≥ 3. |
| `needs-work` | Anything less. A gate failed, or a dimension came in below the bar, or both.    |
| `superseded` | A later scorecard covers the same surfaces and replaces this one's conclusions. |

Use `superseded` only when the document itself says it was replaced. A scorecard does not become
superseded just because it is old.

### `scores`

All eight Craft Rubric dimensions, each an integer 1–4, keyed by slug:

`brand` · `typography` · `spacing` · `hierarchy` · `color` · `motion` · `states` · `detail`

They are the same eight, in the same order, as the numbered rows of the rubric's dimension table.
Copy the numbers from the document's own table — the header restates the review, it does not
re-grade it.

### `gates`

All five hard gates, each a boolean, keyed by slug:

`a11y` · `responsive` · `theme-parity` · `no-placeholder` · `screenshots`

A gate is `true` only when the document's `Gates:` line marks it ✅. Every other marker — ❌, ⚠️,
"partial", "unverified", "fail", or a hedge — is `false`. There is no third state, deliberately:
"mostly passes" is the exact reasoning GEN-10 exists to stop, and forcing it to `false` puts the
surface back in the queue instead of into the launch.

Where a document scores several tables at once (a full-product pass, for instance), the header
carries the **lowest** score per dimension and the **strictest** reading per gate across all of
them. A single document's verdict cannot be better than its own worst surface.

---

## Why `verdict: ship` cannot coexist with a failing gate

The schema test rejects any scorecard whose verdict is `ship` while a gate is `false` or a
dimension is below the ship bar of 3.

The rubric already says a gate failure blocks ship regardless of scores. Without the test, though,
nothing stops a reviewer from writing "SHIP, apart from the touch targets — we'll fix it after
launch." That sentence is precisely the knowingly-degraded, good-enough-for-now state GEN-10
forbids, and it is the kind of thing that reads as reasonable in the moment and indefensible three
months later. Making it a red test means the only way to record `ship` is to actually fix the
surface.

A `needs-work` verdict is not a failure of process — it is the process working. What fails is a
`ship` that is not true.

---

## Adding a scorecard

1. Run `/design-review <route>` (see [`.claude/skills/design-review/SKILL.md`](../../../.claude/skills/design-review/SKILL.md)).
2. Write the header first, then the body, to `docs/design/audits/YYYY-MM-DD-<surface>.md`.
3. Add the surface to [`docs/design/surface-inventory.md`](../surface-inventory.md) by hand if
   it is not already listed. That file is hand-maintained; the generator it names has never
   existed, which its own opening paragraph records.
4. `pnpm exec prettier --write docs/design/audits/<your-file>.md docs/design/surface-inventory.md`
5. `pnpm --filter @docket/test-utils test`

Step 3 is not optional. The inventory's Coverage line is the GEN-10 progress number, and a
scorecard that lands without regenerating it leaves that number wrong — which the coverage test
will tell you about immediately.

`screenshots/` in this directory holds captured evidence, not scorecards. It and this README are
the only things here without a header.
