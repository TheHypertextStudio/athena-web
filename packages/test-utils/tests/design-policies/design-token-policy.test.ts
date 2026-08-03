/**
 * Design-token policy — the CI gate for the design system.
 *
 * @remarks
 * ## What this replaces
 *
 * The launch audit proved the standards were unenforced by injecting the exact violations the bar
 * names — `const CRAFT_PROBE_COLOR = '#ff00ff'; const CRAFT_PROBE_CLASS = 'text-[13px] p-[7px]';` —
 * into a production component and running every gate. `pnpm exec eslint` exited 0 with no output;
 * `pnpm exec vitest run tests/workspace-policies` reported 11 passed. Both green, with the
 * violation sitting in the file. A standard nothing checks is a preference.
 *
 * This test is the check. It runs under `turbo run test`, which is a `needs` of the production
 * deploy job, so a violation blocks the deploy and not merely a reviewer's attention.
 *
 * ## The ratchet
 *
 * At the time this landed there were 1,394 pre-existing violations across 244 files — 1,344 of
 * them raw type utilities. Failing on all of them immediately would have meant a red CI that
 * eleven people building screens in parallel would have had to disable, which is how enforcement
 * dies. Instead the current state is recorded in `design-token-debt.json` and the test enforces a
 * **one-way ratchet**:
 *
 * 1. A file with **no ledger entry** must have **zero** violations. New files, and every file
 *    someone finishes migrating, are held to the real standard.
 * 2. A file with a ledger entry may not **exceed** its recorded count. Adding one more `text-xs`
 *    to a file that already has twelve fails, so debt cannot grow anywhere.
 * 3. A file whose count reaches **zero** must be **removed** from the ledger. A finished file
 *    cannot keep its exemption, so the ledger can only shrink and cannot quietly become permanent
 *    cover.
 * 4. `packages/ui/src/primitives/**` — the design system itself — is held to zero with **no ledger
 *    entries permitted at all**. The source of truth does not get to carry debt.
 *
 * The ledger is not an ignore list under rule 3: an entry is a debt with a maturity date, and the
 * test collects on it. Launch sign-off is the ledger being empty, which makes progress countable
 * (`jq 'add | add' design-token-debt.json`) instead of a matter of opinion.
 *
 * ## Proving the rules fire
 *
 * The first test scans an inline fixture containing one instance of every violation the rules are
 * meant to catch, plus the near-misses they must *not* catch (`text-on-surface-variant`,
 * `shadow-none`, `hover:translate-y-0.5`, `text-[var(--x)]`). A policy test that only ever asserts
 * "zero violations found in the repo" passes just as happily when its regexes match nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESIGN_TOKEN_RULES,
  type DesignTokenDebtLedger,
  type DesignTokenViolation,
  diffAgainstLedger,
  formatViolations,
  scanDesignTokenRoots,
  scanDesignTokens,
  SHADOW_ALLOWED_FILES,
  tallyViolations,
} from './design-token-scan';
import { WORKSPACE_ROOT } from '../workspace';

/** Every tree whose visual values must trace to the design system. */
const ENFORCED_ROOTS = ['apps/web/src', 'apps/admin/src', 'packages/ui/src'] as const;

/** The design system's own primitives: zero violations, zero ledger entries, no exceptions. */
const ZERO_TOLERANCE_PREFIX = 'packages/ui/src/primitives/';

const LEDGER_PATH = resolve(
  WORKSPACE_ROOT,
  'packages/test-utils/tests/design-policies/design-token-debt.json',
);

function readLedger(): DesignTokenDebtLedger {
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as DesignTokenDebtLedger;
}

function scanEnforcedRoots(): DesignTokenViolation[] {
  return scanDesignTokenRoots(ENFORCED_ROOTS.map((root) => resolve(WORKSPACE_ROOT, root)));
}

describe('design token policy', () => {
  it('fires on every forbidden visual value and spares the legal near-misses', () => {
    const fixture = `
      const raw = 'text-xs text-2xl font-semibold leading-tight tracking-widest';
      const arbitraryType = 'text-[13px] leading-[1.1] tracking-[-0.015em]';
      const grow =
        'hover:scale-105 active:scale-[0.99] group-hover:h-10 hover:p-3 focus:text-lg';
      const raised = 'shadow-sm hover:shadow-md';
      const literalColor = '#7a5cff';
      const literalRgb = 'rgba(0, 0, 0, 0.1)';
      const templated = \`gap-2 \${spacing} text-sm\`;

      // Legal: token colours, token type, an explicit no-shadow, a token reference in brackets,
      // a movement (not a resize) on hover, and a static size that no interaction changes.
      const legal =
        'text-on-surface-variant text-body-medium text-label-small shadow-none ' +
        'text-[var(--radix-x)] hover:translate-y-0.5 hover:bg-surface-container-high size-4.5 h-8';
    `;

    const violations = scanDesignTokens(
      resolve(WORKSPACE_ROOT, 'apps/web/src/fixture.ts'),
      fixture,
    );
    const values = violations.map((violation) => violation.value);

    for (const expected of [
      'text-xs',
      'text-2xl',
      'font-semibold',
      'leading-tight',
      'tracking-widest',
      'text-[13px]',
      'leading-[1.1]',
      'tracking-[-0.015em]',
      'hover:scale-105',
      'active:scale-[0.99]',
      'group-hover:h-10',
      'hover:p-3',
      'focus:text-lg',
      'shadow-sm',
      'shadow-md',
      '#7a5cff',
      'rgba(',
      'text-sm',
    ]) {
      expect(values, `expected the scanner to flag ${expected}`).toContain(expected);
    }

    // Every rule must be exercised by the fixture, so none can rot into a dead regex.
    for (const rule of DESIGN_TOKEN_RULES) {
      expect(
        violations.some((violation) => violation.rule === rule),
        `expected the fixture to exercise the ${rule} rule`,
      ).toBe(true);
    }

    for (const legal of [
      'text-on-surface-variant',
      'text-body-medium',
      'text-label-small',
      'shadow-none',
      'text-[var(--radix-x)]',
      'hover:translate-y-0.5',
      'hover:bg-surface-container-high',
      'size-4.5',
      'h-8',
    ]) {
      expect(values, `expected the scanner to allow ${legal}`).not.toContain(legal);
    }
  });

  it('permits shadows only in the enumerated overlay modules', () => {
    const raised = "const c = 'shadow-md';";
    const inOverlay = scanDesignTokens(
      resolve(WORKSPACE_ROOT, 'packages/ui/src/primitives/dialog.tsx'),
      raised,
    );
    const inControl = scanDesignTokens(
      resolve(WORKSPACE_ROOT, 'packages/ui/src/primitives/button.tsx'),
      raised,
    );

    expect(inOverlay.filter((v) => v.rule === 'shadow-outside-overlay')).toEqual([]);
    expect(inControl.map((v) => v.rule)).toContain('shadow-outside-overlay');
  });

  it('keeps every enumerated overlay module on disk', () => {
    // A stale allow-set entry is how an exemption outlives the file it was written for.
    for (const file of SHADOW_ALLOWED_FILES) {
      expect(() => readFileSync(resolve(WORKSPACE_ROOT, file), 'utf8'), file).not.toThrow();
    }
  });

  it('holds the design system primitives to zero, with no ledger entries permitted', () => {
    const violations = scanEnforcedRoots().filter((violation) =>
      violation.file.startsWith(ZERO_TOLERANCE_PREFIX),
    );

    expect(
      violations,
      [
        'The design system primitives must contain no off-token visual values.',
        'Type comes from the MD3 roles in primitives/text.tsx; height, padding, and icon size',
        'come from the scale in primitives/control.tsx; shadows belong to overlays only.',
        formatViolations(violations),
      ].join('\n'),
    ).toEqual([]);

    const ledgered = Object.keys(readLedger()).filter((file) =>
      file.startsWith(ZERO_TOLERANCE_PREFIX),
    );
    expect(
      ledgered,
      'The design system itself may not carry design-token debt. Fix the primitive, do not ledger it.',
    ).toEqual([]);
  }, // A full-workspace source scan: the monorepo has grown enough that this can exceed the
  // default 30s timeout under coverage instrumentation on a slower CI runner, even though it
  // finishes in a few seconds locally. Generous, not tuned to a moving target.
  120_000);

  it('ratchets: new debt fails, unchanged debt passes, a cleaned file must be delisted', () => {
    const ledger: DesignTokenDebtLedger = {
      'apps/web/src/legacy.tsx': { 'raw-type-utility': 3 },
      'apps/web/src/finished.tsx': { 'raw-type-utility': 2 },
    };

    // Unchanged debt, and debt that has partially been paid down, both pass.
    expect(
      diffAgainstLedger(
        {
          'apps/web/src/legacy.tsx': { 'raw-type-utility': 3 },
          'apps/web/src/finished.tsx': { 'raw-type-utility': 1 },
        },
        ledger,
      ).regressions,
    ).toEqual([]);

    // One more violation in a file that already had debt fails.
    expect(
      diffAgainstLedger(
        {
          'apps/web/src/legacy.tsx': { 'raw-type-utility': 4 },
          'apps/web/src/finished.tsx': { 'raw-type-utility': 2 },
        },
        ledger,
      ).regressions,
    ).toHaveLength(1);

    // A brand-new file with any violation fails — there is no grandfathering for new code.
    expect(
      diffAgainstLedger(
        {
          'apps/web/src/legacy.tsx': { 'raw-type-utility': 3 },
          'apps/web/src/finished.tsx': { 'raw-type-utility': 2 },
          'apps/web/src/brand-new.tsx': { 'hardcoded-color': 1 },
        },
        ledger,
      ).regressions,
    ).toHaveLength(1);

    // A different rule appearing in a ledgered file fails: the entry covers one rule, not the file.
    expect(
      diffAgainstLedger(
        {
          'apps/web/src/legacy.tsx': { 'raw-type-utility': 3, 'shadow-outside-overlay': 1 },
          'apps/web/src/finished.tsx': { 'raw-type-utility': 2 },
        },
        ledger,
      ).regressions,
    ).toHaveLength(1);

    // A file that reaches zero must be delisted, so the ledger can only shrink.
    expect(
      diffAgainstLedger({ 'apps/web/src/legacy.tsx': { 'raw-type-utility': 3 } }, ledger).stale,
    ).toEqual([
      'apps/web/src/finished.tsx [raw-type-utility] is clean — remove this entry from design-token-debt.json',
    ]);
  });

  it('lets no file introduce or increase design-token debt', () => {
    const { regressions } = diffAgainstLedger(tallyViolations(scanEnforcedRoots()), readLedger());

    expect(
      regressions,
      [
        'New or increased design-token debt.',
        'Type: use a `text-<md3-role>` token (see packages/ui/src/primitives/text.tsx) or the <Text> primitive.',
        'Height/padding/icon size: take them from <ControlGroup> and the CONTROL scale, never inline.',
        'Shadows: only the enumerated overlay primitives may render one.',
        'Colours: use a semantic token; a hex literal cannot follow the theme.',
        'The ledger records pre-existing debt only. It may shrink; it may never grow.',
        regressions.join('\n'),
      ].join('\n'),
    ).toEqual([]);
  });

  it('drops ledger entries for files that no longer carry debt', () => {
    const { stale } = diffAgainstLedger(tallyViolations(scanEnforcedRoots()), readLedger());

    expect(
      stale,
      [
        'Stale design-token debt entries.',
        'A file that has been migrated must lose its ledger entry, so the ledger can only shrink.',
        'This is the ratchet: launch sign-off is design-token-debt.json being an empty object.',
        stale.join('\n'),
      ].join('\n'),
    ).toEqual([]);
  });

  it('records only rules the scanner implements', () => {
    const known = new Set<string>(DESIGN_TOKEN_RULES);
    const unknown = Object.entries(readLedger()).flatMap(([file, rules]) =>
      Object.keys(rules)
        .filter((rule) => !known.has(rule))
        .map((rule) => `${file} [${rule}]`),
    );
    expect(unknown, 'Unknown rule name in design-token-debt.json').toEqual([]);
  });
});
