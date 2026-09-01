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

import { beforeAll, describe, expect, it } from 'vitest';

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
      const legacyRoles = 'bg-card text-muted-foreground border-border bg-destructive';

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

    // `raw-shadow-on-overlay` is the mirror of `shadow-outside-overlay`, so it only fires for a
    // path inside SHADOW_ALLOWED_FILES. Scanning the same fixture as an overlay module exercises
    // it, and confirms that `shadow-level*` and `shadow-none` are the two spellings that pass.
    const overlayFixture = `
      const raised = 'shadow-md hover:shadow-lg shadow-2xl';
      const legal = 'shadow-level2 shadow-level0 shadow-none';
    `;
    const overlayViolations = scanDesignTokens(
      resolve(WORKSPACE_ROOT, 'packages/ui/src/primitives/dialog.tsx'),
      overlayFixture,
    );
    expect(overlayViolations.map((violation) => violation.value).sort()).toEqual([
      'shadow-2xl',
      'shadow-lg',
      'shadow-md',
    ]);

    // `ad-hoc-border` is scoped by RULE_ROOTS to `apps/admin/src`, so it needs its own fixture
    // scanned at an admin path. Scanning the identical text at a web path below proves the scope
    // is real rather than incidental.
    const borderFixture = `
      const drawn = 'border border-l border-b border-2 border-dashed border-outline-variant';
      const tinted = 'border-error/40';
      // A border that only appears on hover is decoration, which is what the rule bans; only a
      // focus indicator earns one.
      const decorative = 'hover:border-outline';

      // Legal: "nothing is drawn" on any side, table-layout utilities that only share the prefix,
      // and a border behind a focus variant (design-system §8 earns one for a focus indicator).
      const legal =
        'border-none border-0 border-transparent border-x-0 border-t-transparent ' +
        'border-collapse border-separate border-spacing-2 ' +
        'focus:border-primary focus-visible:border-primary focus-within:border-primary ' +
        'group-focus-visible:border-primary rounded-xl';
    `;
    const borderViolations = scanDesignTokens(
      resolve(WORKSPACE_ROOT, 'apps/admin/src/fixture.ts'),
      borderFixture,
    ).filter((violation) => violation.rule === 'ad-hoc-border');
    expect(borderViolations.map((violation) => violation.value).sort()).toEqual([
      'border',
      'border-2',
      'border-b',
      'border-dashed',
      'border-error/40',
      'border-l',
      'border-outline',
      'border-outline-variant',
    ]);

    // The same text outside the rule's roots must produce nothing.
    expect(
      scanDesignTokens(resolve(WORKSPACE_ROOT, 'apps/web/src/fixture.ts'), borderFixture).filter(
        (violation) => violation.rule === 'ad-hoc-border',
      ),
    ).toEqual([]);

    const values = [...violations, ...overlayViolations, ...borderViolations].map(
      (violation) => violation.value,
    );

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
      'bg-card',
      'text-muted-foreground',
      'border-border',
      'bg-destructive',
      'border-l',
      'border-dashed',
      'border-outline-variant',
    ]) {
      expect(values, `expected the scanner to flag ${expected}`).toContain(expected);
    }

    // Every rule must be exercised by the fixture, so none can rot into a dead regex.
    for (const rule of DESIGN_TOKEN_RULES) {
      expect(
        [...violations, ...overlayViolations, ...borderViolations].some(
          (violation) => violation.rule === rule,
        ),
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
      'border-none',
      'border-transparent',
      'border-x-0',
      'border-t-transparent',
      'border-collapse',
      'border-spacing-2',
      'focus-within:border-primary',
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

  // The three tests below each need every violation across the enforced roots, and re-walking
  // and re-parsing the whole workspace three separate times is what made this file exceed the
  // default per-test timeout under coverage instrumentation on a slower CI runner (each of the
  // three has independently been the one to lose that race). Scanning once here and sharing the
  // result removes the redundant work rather than just widening the budget three times over.
  let allViolations: DesignTokenViolation[];
  beforeAll(() => {
    allViolations = scanEnforcedRoots();
  });

  it('holds the design system primitives to zero, with no ledger entries permitted', () => {
    const violations = allViolations.filter((violation) =>
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
  });

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
    const { regressions } = diffAgainstLedger(tallyViolations(allViolations), readLedger());

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
    const { stale } = diffAgainstLedger(tallyViolations(allViolations), readLedger());

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
