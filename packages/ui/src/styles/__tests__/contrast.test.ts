import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, '../globals.css'), 'utf8');

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
];

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
  }
});
