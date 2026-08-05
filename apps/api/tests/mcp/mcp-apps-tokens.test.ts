/**
 * The widget stylesheet's token vocabulary, checked against the committed specification.
 *
 * @remarks
 * Widget styling is the one part of this surface with no runtime feedback: a widget that asks a
 * host for a variable the host has never heard of does not throw, does not warn, and does not fail
 * a request. It renders wrong, in someone else's product, and the first report is a screenshot.
 *
 * Docket shipped exactly that. The stylesheet asked for `--color-surface-primary`,
 * `--color-accent-primary`, `--color-danger-primary`, and `--font-family-sans`, none of which the
 * extension defines, so no host ever supplied one — and every declaration it wrote them into was
 * self-referential (`--x: var(--x, fallback)`), which CSS resolves as a dependency cycle to
 * guaranteed-invalid *before* it reaches the fallback. The card lost its background and its font
 * and rendered in browser-default serif.
 *
 * These three assertions are what make both mistakes unrepeatable. The spec side is parsed from
 * `docs/engineering/specs/vendor/`, not typed from memory, so a vocabulary change upstream turns
 * the gate red on the next run rather than at the next screenshot.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RUNTIME_CSS, RUNTIME_JS } from '../../src/mcp/apps/runtime';

/** The vendored copy of the extension's type source. */
const SPEC_TYPES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/engineering/specs/vendor/mcp-apps-2026-01-26.spec.types.txt',
);

/**
 * Variables the widgets own outright.
 *
 * @remarks
 * The extension standardizes no vocabulary for workflow state, so these cannot come from a host and
 * are declared with literal `light-dark()` values instead. Docket's own host overrides them with
 * the real `--state-*` tokens; every other host gets the fallbacks. Anything added here is a
 * deliberate decision that a host will never be able to theme it.
 */
const WIDGET_OWNED: readonly string[] = [
  '--state-backlog',
  '--state-unstarted',
  '--state-started',
  '--state-completed',
  '--state-canceled',
];

/** Every `--custom-property` the spec's `McpUiStyleVariableKey` union defines. */
function specStyleVariableKeys(): Set<string> {
  const source = readFileSync(SPEC_TYPES, 'utf8');
  const start = source.indexOf('export type McpUiStyleVariableKey =');
  if (start < 0) {
    throw new Error('Vendored spec types no longer declare McpUiStyleVariableKey');
  }
  const end = source.indexOf(';', start);
  const keys = source.slice(start, end).match(/"(--[a-z0-9-]+)"/g) ?? [];
  const parsed = new Set(keys.map((quoted) => quoted.slice(1, -1)));
  // A parse that silently matched nothing would make every assertion below vacuously pass.
  expect(parsed.size).toBeGreaterThan(40);
  return parsed;
}

/**
 * The stylesheet with comments removed.
 *
 * @remarks
 * Stripped before anything is parsed, for two independent reasons: prose contains semicolons, and
 * splitting declarations on `;` would otherwise swallow whichever one follows a comment; and prose
 * mentions token names, which would otherwise count as `var()` references that nothing declares.
 */
function styleSheet(): string {
  return RUNTIME_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The `:root` block of the widget stylesheet, as `name → value` pairs. */
function rootDeclarations(): Map<string, string> {
  const block = /:root\s*\{([\s\S]*?)\}/.exec(styleSheet());
  if (!block?.[1]) {
    throw new Error('RUNTIME_CSS no longer has a :root block');
  }
  const declarations = new Map<string, string>();
  for (const line of block[1].split(';')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(line);
    if (match?.[1] && match[2]) {
      declarations.set(match[1], match[2].trim());
    }
  }
  return declarations;
}

/** Every custom property the stylesheet reads through `var()`. */
function referencedVariables(): Set<string> {
  const names = styleSheet().match(/var\(\s*(--[a-z0-9-]+)/g) ?? [];
  return new Set(names.map((call) => call.replace(/var\(\s*/, '')));
}

describe('widget stylesheet token vocabulary', () => {
  it('parses something, so the assertions below are not vacuous', () => {
    // Every other test in this file asserts a filtered list is empty. A parser that matched
    // nothing would satisfy all of them, which is the one way this gate could rot silently.
    expect(rootDeclarations().size).toBeGreaterThan(15);
    expect(referencedVariables().size).toBeGreaterThan(10);
    expect(rootDeclarations().get('--color-background-primary')).toContain('light-dark(');
  });

  it('declares only names the extension defines, or names it deliberately owns', () => {
    const allowed = new Set([...specStyleVariableKeys(), ...WIDGET_OWNED]);
    const foreign = [...rootDeclarations().keys()].filter((name) => !allowed.has(name));

    // A name outside the union is not a customization. It is a variable no host will ever send,
    // so the declaration is dead and the widget silently keeps its fallback forever.
    expect(foreign, 'declared but outside the spec vocabulary').toEqual([]);
  });

  it('never declares a custom property in terms of itself', () => {
    const cycles = [...rootDeclarations().entries()]
      .filter(([name, value]) => new RegExp(`var\\(\\s*${name}\\b`).test(value))
      .map(([name]) => name);

    // `--x: var(--x, fallback)` is a dependency cycle, which CSS resolves to guaranteed-invalid
    // without ever reaching the fallback. It reads like a default and behaves like a deletion.
    expect(cycles, 'self-referential declarations').toEqual([]);
  });

  it('gives every variable it reads a fallback declaration', () => {
    const declared = rootDeclarations();
    const undeclared = [...referencedVariables()].filter((name) => !declared.has(name));

    // The spec lets a host supply any subset of the vocabulary, or none of it. Every `var()` the
    // stylesheet reads therefore needs a value of its own, or that property resolves to `unset`
    // against a host that stayed quiet.
    expect(undeclared, 'read through var() with no :root fallback').toEqual([]);
  });

  it('survives being written as a template literal', () => {
    // RUNTIME_CSS and RUNTIME_JS are String.raw templates, so one backtick in a comment silently
    // ends the string and takes the rest of the stylesheet or the whole client with it. TypeScript
    // usually catches the fallout as a parse error somewhere unrelated; this says what happened.
    expect(RUNTIME_CSS, 'a backtick would have truncated this').not.toContain('`');
    expect(RUNTIME_JS, 'a backtick would have truncated this').not.toContain('`');
    // The last thing each one defines, so a silent truncation cannot pass.
    expect(RUNTIME_CSS).toContain('@container');
    expect(RUNTIME_JS).toContain('stateGlyph');
  });

  it('carries a glyph and a colour for every canonical workflow-state type', () => {
    const declared = rootDeclarations();
    for (const type of ['backlog', 'unstarted', 'started', 'completed', 'canceled']) {
      // The inline row cap means a screenshot can only ever show four of the five, so the fifth
      // is held here rather than left to whichever fixture happens to fit above the fold.
      expect(RUNTIME_JS, `${type} has no glyph`).toMatch(new RegExp(`${type}:\\s*'<svg`));
      expect(declared.has(`--state-${type}`), `${type} has no colour`).toBe(true);
    }
  });

  it('states a colour scheme, so its light-dark() fallbacks have a basis', () => {
    // `light-dark()` resolves against the used `color-scheme`. Without this the dark halves are
    // unreachable and a dark host that omits a colour gets the light value on a dark surface.
    expect(rootDeclarations().size).toBeGreaterThan(0);
    expect(RUNTIME_CSS).toMatch(/color-scheme:\s*light dark/);
  });
});
