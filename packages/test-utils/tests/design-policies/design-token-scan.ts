/**
 * Design-token conformance scanner.
 *
 * @remarks
 * Reads production UI source and reports every visual value that does not come from the design
 * system. It is deliberately **mechanical**: it decides nothing about whether a given screen looks
 * good, only whether the values it renders exist in the token set. That is the property the launch
 * bar asks for — "flagging is mechanical, not editorial" — and it is the only kind of check that
 * can survive eleven people building screens in parallel.
 *
 * ## Why the TypeScript AST and not grep
 *
 * Every rule here matches inside **string literals only**. A regex over raw file text flags the
 * word `shadow-sm` in a doc comment explaining why shadows were removed, and `text-xs` in the
 * migration note listing what was replaced — so the honest, well-documented file fails and the
 * silent one passes. Walking the AST and inspecting only string and template-literal text means
 * the scanner reads what ships, not what is written about it.
 *
 * ## The rules
 *
 * | Rule | Fails on | Because |
 * |---|---|---|
 * | `raw-type-utility` | `text-xs`, `text-2xl`, `text-[13px]`, `leading-tight`, `leading-[1.1]`, `tracking-tight`, `font-semibold` | Tailwind's stock type scale is a second, unnamed type system running alongside the MD3 one. Size, line-height, weight, and tracking are set *together* by one `text-<role>` token; setting any of them separately forks the scale. |
 * | `size-changing-interaction` | `hover:scale-105`, `active:scale-95`, `hover:p-3`, `group-hover:h-10`, `hover:text-lg` | An interactive element must never change its own size when hovered, focused, or pressed. Feedback is colour and the focus ring. |
 * | `shadow-outside-overlay` | any `shadow-*` outside the enumerated overlay modules | A shadow means "this surface floats above the page". Only overlays do. On a 32px control it is noise. |
 * | `hardcoded-color` | `#7a5cff`, `rgb(…)`, `rgba(…)`, `hsl(…)` | A literal colour cannot follow the light/dark theme and is invisible to every downstream token change. |
 *
 * @see `packages/ui/src/primitives/text.tsx` for the token set `raw-type-utility` is defined against.
 * @see `docs/design/design-system.md` for the contract these rules enforce.
 */
import { readFileSync } from 'node:fs';

import ts from 'typescript';

import { relativeToWorkspaceRoot } from '../workspace';

/** The rule identifiers the scanner can report. */
export type DesignTokenRule =
  | 'raw-type-utility'
  | 'size-changing-interaction'
  | 'shadow-outside-overlay'
  | 'hardcoded-color';

/** Every rule the scanner implements, for exhaustive reporting and ledger validation. */
export const DESIGN_TOKEN_RULES: readonly DesignTokenRule[] = [
  'raw-type-utility',
  'size-changing-interaction',
  'shadow-outside-overlay',
  'hardcoded-color',
];

/** One flagged value, located precisely enough to fix without searching. */
export interface DesignTokenViolation {
  /** Workspace-relative path. */
  readonly file: string;
  /** 1-indexed line of the string literal containing the value. */
  readonly line: number;
  /** 1-indexed column of the string literal containing the value. */
  readonly column: number;
  /** Which rule fired. */
  readonly rule: DesignTokenRule;
  /** The exact offending token, e.g. `text-xs` or `hover:scale-105`. */
  readonly value: string;
}

/**
 * The overlay surfaces permitted to render a shadow.
 *
 * @remarks
 * This is the *enumerated allowed set* the design rule is written against, not an ignore list: a
 * shadow is correct for a surface that floats over arbitrary page content, and these are all of
 * them. MD3 agrees — `md.comp.menu.container-elevation` is `level2` (3dp) while every chip, button,
 * card, and field is `level0`.
 *
 * Adding a path here is a design decision that has to answer one question: does this surface float
 * over content the user can still see? If the answer is no, the entry does not belong.
 */
export const SHADOW_ALLOWED_FILES: ReadonlySet<string> = new Set([
  'packages/ui/src/primitives/dialog.tsx',
  'packages/ui/src/primitives/sheet.tsx',
  'packages/ui/src/primitives/popover.tsx',
  'packages/ui/src/primitives/tooltip.tsx',
  'packages/ui/src/primitives/hover-card.tsx',
  'packages/ui/src/primitives/menu-styles.ts',
  'packages/ui/src/primitives/dropdown-menu.tsx',
  'packages/ui/src/primitives/context-menu.tsx',
  'apps/web/src/components/command-palette/command-palette.tsx',
  // The editor's `@`/`/` suggestion list. It is a floating overlay in every sense that matters
  // here — portalled to the body, positioned against the caret, clamped to the viewport with
  // OVERLAY_COLLISION_PADDING — but it cannot be a DropdownMenu, because a Radix menu takes
  // focus and this list must leave the caret in the editor so typing keeps filtering. It
  // therefore needs the same elevation as the menus it sits alongside.
  'apps/web/src/components/editor/suggestion-menu.tsx',
]);

/**
 * Tailwind font-size utilities from the stock scale — the parallel type system.
 *
 * @remarks
 * `text-<colour>` shares this prefix, so the rule matches only the known size names rather than
 * everything after `text-`. That keeps `text-on-surface-variant` legal and `text-sm` not.
 */
const STOCK_TEXT_SIZES = 'xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl';

/** Tailwind font-weight utilities. Weight belongs to the type role, never to the callsite. */
const STOCK_FONT_WEIGHTS = 'thin|extralight|light|normal|medium|semibold|bold|extrabold|black';

/** Tailwind line-height and letter-spacing utilities from the stock scale. */
const STOCK_LEADING = 'none|tight|snug|normal|relaxed|loose|3|4|5|6|7|8|9|10';
const STOCK_TRACKING = 'tighter|tight|normal|wide|wider|widest';

/**
 * Geometry-affecting utility prefixes that must never appear behind an interaction variant.
 *
 * @remarks
 * `translate-*` and `rotate-*` are absent on purpose: they move an element without resizing it,
 * which is a legitimate (if rarely needed) affordance. `scale-*` is the one transform that changes
 * apparent size, and it is the one the review called out by name.
 */
const GEOMETRY_PREFIXES =
  'scale|scale-x|scale-y|size|w|h|min-w|min-h|max-w|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|leading|tracking';

/** Interaction-state variants under which a geometry change is a violation. */
const INTERACTION_VARIANTS =
  'hover|active|focus|focus-visible|focus-within|group-hover|group-active|group-focus|peer-hover|peer-focus';

const RULE_PATTERNS: readonly {
  readonly rule: DesignTokenRule;
  readonly pattern: RegExp;
}[] = [
  // Stock font sizes, weights, line heights, and tracking — including their arbitrary-value forms.
  {
    rule: 'raw-type-utility',
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:` +
        String.raw`text-(?:${STOCK_TEXT_SIZES})` +
        String.raw`|font-(?:${STOCK_FONT_WEIGHTS})` +
        String.raw`|leading-(?:${STOCK_LEADING})` +
        String.raw`|tracking-(?:${STOCK_TRACKING})` +
        // Arbitrary type values: text-[13px], leading-[1.1], tracking-[-0.015em]. A CSS-variable
        // reference (text-[var(--x)]) is a token reference and stays legal.
        String.raw`|(?:text|leading|tracking)-\[(?!var\(|--)[^\]]*\]` +
        String.raw`)(?![\w-])`,
      'g',
    ),
  },
  {
    rule: 'size-changing-interaction',
    pattern: new RegExp(
      String.raw`(?<![\w-])(?:${INTERACTION_VARIANTS}):-?(?:` +
        String.raw`(?:${GEOMETRY_PREFIXES})-(?:\[[^\]]*\]|[\w.%/-]+)` +
        // A font-size change on hover resizes the label, and therefore the control around it.
        // Colour changes (`hover:text-on-surface`) are the whole point of a state layer and stay
        // legal, which is why this alternative names the stock size scale rather than `text-*`.
        String.raw`|text-(?:${STOCK_TEXT_SIZES})` +
        String.raw`)`,
      'g',
    ),
  },
  {
    rule: 'shadow-outside-overlay',
    // `shadow-none` is the assertion that there is no shadow — always legal.
    pattern: /(?<![\w-])shadow(?:-(?!none)[\w.[\]/-]+)?(?![\w-])/g,
  },
  {
    rule: 'hardcoded-color',
    pattern: /(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\()/g,
  },
];

/** Collect production `.ts`/`.tsx` files under a directory, excluding tests and declarations. */
export function collectDesignSourceFiles(directory: string): string[] {
  return ts.sys
    .readDirectory(directory, ['.ts', '.tsx'], undefined, undefined)
    .filter((path) => !/\.(?:test|spec)\.tsx?$/.test(path) && !path.endsWith('.d.ts'));
}

/**
 * Scan one file's source text for design-token violations.
 *
 * @param filePath - Absolute path, used for reporting and for the shadow allow-set lookup.
 * @param sourceText - The file's contents.
 * @returns Every violation, in source order.
 *
 * @remarks
 * Exported separately from the filesystem walk so the policy test can run the scanner against an
 * inline fixture and prove each rule actually fires — a policy test that only asserts "zero
 * violations found" is indistinguishable from a policy test whose regexes never match anything.
 */
export function scanDesignTokens(filePath: string, sourceText: string): DesignTokenViolation[] {
  const relativePath = relativeToWorkspaceRoot(filePath);
  const shadowAllowed = SHADOW_ALLOWED_FILES.has(relativePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: DesignTokenViolation[] = [];

  function inspect(text: string, node: ts.Node): void {
    for (const { rule, pattern } of RULE_PATTERNS) {
      if (rule === 'shadow-outside-overlay' && shadowAllowed) continue;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          file: relativePath,
          line: location.line + 1,
          column: location.character + 1,
          rule,
          value: match[0],
        });
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) {
      inspect(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      // Only the literal spans are authored class text; the substitutions are values.
      inspect(node.head.text, node);
      for (const span of node.templateSpans) inspect(span.literal.text, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

/** Scan every production file under the given roots. */
export function scanDesignTokenRoots(absoluteRoots: readonly string[]): DesignTokenViolation[] {
  return absoluteRoots.flatMap((root) =>
    collectDesignSourceFiles(root).flatMap((file) =>
      scanDesignTokens(file, readFileSync(file, 'utf8')),
    ),
  );
}

/** Aggregate violations into `{ file: { rule: count } }`, the shape the debt ledger stores. */
export function tallyViolations(
  violations: readonly DesignTokenViolation[],
): Record<string, Partial<Record<DesignTokenRule, number>>> {
  const tally: Record<string, Partial<Record<DesignTokenRule, number>>> = {};
  for (const violation of violations) {
    const forFile = (tally[violation.file] ??= {});
    forFile[violation.rule] = (forFile[violation.rule] ?? 0) + 1;
  }
  return tally;
}

/** Render violations as `path:line:col [rule] value` lines for a failure message. */
export function formatViolations(violations: readonly DesignTokenViolation[]): string {
  return violations.map((v) => `${v.file}:${v.line}:${v.column} [${v.rule}] ${v.value}`).join('\n');
}

/** The shape `design-token-debt.json` stores: `{ file: { rule: count } }`. */
export type DesignTokenDebtLedger = Readonly<
  Record<string, Readonly<Partial<Record<DesignTokenRule, number>>>>
>;

/** What the ratchet found when comparing a scan against the recorded debt. */
export interface LedgerDiff {
  /** Debt that is new or has grown — the build must fail. */
  readonly regressions: readonly string[];
  /** Ledger entries whose files are now clean — the entry must be deleted. */
  readonly stale: readonly string[];
}

/**
 * Compare a scan against the debt ledger.
 *
 * @param tally - Violations aggregated by {@link tallyViolations}.
 * @param ledger - The recorded pre-existing debt.
 * @returns The regressions and stale entries the policy test asserts are both empty.
 *
 * @remarks
 * A one-way ratchet, and the asymmetry is the point. Exceeding a recorded count fails immediately,
 * so debt can never grow. Falling *below* one does not fail, so eleven people migrating files in
 * parallel are not forced to renegotiate a shared JSON file on every commit — but reaching zero
 * does fail until the entry is deleted, so a finished file cannot keep its exemption and the
 * ledger cannot become permanent cover. Sign-off is the ledger being `{}`.
 *
 * Pure, so the policy test can prove the ratchet with synthetic input instead of only observing it
 * pass against whatever the repo happens to contain today.
 */
export function diffAgainstLedger(
  tally: Readonly<Record<string, Partial<Record<DesignTokenRule, number>>>>,
  ledger: DesignTokenDebtLedger,
): LedgerDiff {
  const regressions: string[] = [];
  const stale: string[] = [];

  for (const [file, rules] of Object.entries(tally)) {
    for (const rule of DESIGN_TOKEN_RULES) {
      const found = rules[rule] ?? 0;
      if (found === 0) continue;
      const allowed = ledger[file]?.[rule] ?? 0;
      if (found > allowed) {
        regressions.push(
          `${file} [${rule}] ${String(found)} found, ${String(allowed)} allowed by the ledger`,
        );
      }
    }
  }

  for (const [file, rules] of Object.entries(ledger)) {
    for (const rule of Object.keys(rules) as DesignTokenRule[]) {
      if ((tally[file]?.[rule] ?? 0) === 0) {
        stale.push(`${file} [${rule}] is clean — remove this entry from design-token-debt.json`);
      }
    }
  }

  return { regressions, stale };
}
