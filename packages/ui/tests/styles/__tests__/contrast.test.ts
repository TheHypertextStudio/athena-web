import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { converter, parse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

const toOklch = converter('oklch');

/** OKLCH lightness (0–1) of a token value. */
function lightness(tokens: Record<string, string>, name: string): number {
  const c = toOklch(parse(tokens[name] ?? ''));
  if (!c) throw new Error(`unparseable token: ${name}=${String(tokens[name])}`);
  return c.l;
}

const css = readFileSync(resolve(import.meta.dirname, '../../../src/styles/globals.css'), 'utf8');

/** Extract `--name: value;` declarations from a CSS block selector (`:root` / `.dark`). */
function tokensOf(selector: string): Record<string, string> {
  const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  const out: Record<string, string> = {};
  if (!block?.[1]) return out;
  for (const m of block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[m[1]!.trim()] = m[2]!.trim();
  }
  return out;
}

/** WCAG contrast ratio between two token values. */
function ratio(tokens: Record<string, string>, a: string, b: string): number {
  const ca = parse(tokens[a] ?? '');
  const cb = parse(tokens[b] ?? '');
  if (!ca || !cb)
    throw new Error(`unparseable token: ${a}=${String(tokens[a])} / ${b}=${String(tokens[b])}`);
  return wcagContrast(ca, cb);
}

/** Text pairs that must meet WCAG AA (4.5:1). */
const TEXT_PAIRS: [string, string][] = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--accent-foreground', '--accent'],
  ['--muted-foreground', '--background'],
  ['--destructive-foreground', '--destructive'],
  // MD3 tonal surface ramp — body text must be readable on every container tone it lands on,
  // including the floating-panel `--surface` (sidebar / main / active tab) and the hover/overlay
  // tones it can step up to.
  ['--on-surface', '--surface'],
  ['--on-surface', '--surface-container-lowest'],
  ['--on-surface', '--surface-container-low'],
  ['--on-surface', '--surface-container'],
  ['--on-surface', '--surface-container-high'],
  ['--on-surface', '--surface-container-highest'],
  ['--on-surface', '--surface-variant'],
  ['--on-surface-variant', '--surface'],
  ['--on-surface-variant', '--surface-container'],
  ['--on-surface-variant', '--surface-container-high'],
];

/**
 * MD3 tonal elevation direction per theme. In LIGHT mode elevated layers brighten toward white,
 * so the floating-panel `--surface` is the brightest tone (above the `--surface-container`
 * canvas) and the container ramp steps progressively darker as it recedes. In DARK mode elevation
 * also reads as LIGHTER per MD3, so `--surface` sits ABOVE the canvas and the ramp brightens with
 * elevation. Either way the panels must never be darker than the canvas they float on.
 */
const ELEVATION: Record<string, 'lighter-up' | 'darker-up'> = {
  ':root': 'darker-up',
  '.dark': 'lighter-up',
};

/** UI/graphical elements that must meet WCAG AA non-text (3:1) against the background. */
const UI_VS_BG: string[] = [
  '--state-backlog',
  '--state-unstarted',
  '--state-started',
  '--state-completed',
  '--state-canceled',
];

describe('design token contrast', () => {
  for (const theme of [':root', '.dark'] as const) {
    const tokens = tokensOf(theme);

    it(`${theme}: text pairs meet AA (≥4.5:1)`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(ratio(tokens, fg, bg), `${fg} on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: state tokens meet non-text AA (≥3:1) on the background`, () => {
      for (const token of UI_VS_BG) {
        expect(
          ratio(tokens, token, '--background'),
          `${token} on --background in ${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: floating-panel surface reads as elevated (lighter) above the canvas`, () => {
      // In BOTH themes the floating panels (`--surface`) must be lighter than the tinted canvas
      // (`--surface-container`): in light mode because panels are the brightest tone, and in dark
      // mode because MD3 dark elevation brightens lifted layers. This guards the regression where
      // dark `--surface` (0.21) sat darker than the canvas (0.23), inverting the elevation.
      const surface = lightness(tokens, '--surface');
      const canvas = lightness(tokens, '--surface-container');
      expect(surface, `--surface vs --surface-container in ${theme}`).toBeGreaterThan(canvas);
    });

    it(`${theme}: container ramp is monotonic in lightness`, () => {
      // The ramp runs lowest → highest in order of *elevation*. In dark mode elevation brightens
      // (lighter-up), so lightness strictly increases; in light mode elevation darkens as it
      // recedes from the bright panels (darker-up), so lightness strictly decreases.
      const ramp = [
        '--surface-container-lowest',
        '--surface-container-low',
        '--surface-container',
        '--surface-container-high',
        '--surface-container-highest',
      ];
      const ls = ramp.map((t) => lightness(tokens, t));
      for (let i = 1; i < ls.length; i += 1) {
        if (ELEVATION[theme] === 'lighter-up') {
          expect(ls[i], `${ramp[i]} steps up from ${ramp[i - 1]} in ${theme}`).toBeGreaterThan(
            ls[i - 1]!,
          );
        } else {
          expect(ls[i], `${ramp[i]} steps down from ${ramp[i - 1]} in ${theme}`).toBeLessThan(
            ls[i - 1]!,
          );
        }
      }
    });
  }
});
