import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { scheduleItemSurfacePalette } from '../../src/components/scheduling/scheduling-item-surface';
import type { ScheduleItemAppearance } from '../../src/components/scheduling/scheduling-types';

const GLOBALS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ui/src/styles/globals.css',
);

interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

function parseOklch(value: string): Oklab {
  const inner = /oklch\(([^)]+)\)/.exec(value)?.[1] ?? '';
  const [l = 0, c = 0, h = 0] = inner.trim().split(/\s+/).map(Number);
  const radians = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(radians), b: c * Math.sin(radians) };
}

function tokenValue(css: string, name: string): string {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found`);
  return value.trim();
}

function themeSlices(): { readonly light: string; readonly dark: string } {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const darkAt = css.indexOf('prefers-color-scheme: dark');
  if (darkAt < 0) throw new Error('dark theme block not found');
  return { light: css.slice(0, darkAt), dark: css.slice(darkAt) };
}

function mix(first: Oklab, share: number, second: Oklab): Oklab {
  const weight = share / 100;
  return {
    l: first.l * weight + second.l * (1 - weight),
    a: first.a * weight + second.a * (1 - weight),
    b: first.b * weight + second.b * (1 - weight),
  };
}

function opaqueColor(value: string, css: string): Oklab {
  const token = /^var\(--color-([^)]+)\)$/.exec(value)?.[1];
  if (token) return parseOklch(tokenValue(css, token));
  if (value === '#000000') return { l: 0, a: 0, b: 0 };
  if (value === '#ffffff') return { l: 1, a: 0, b: 0 };
  throw new Error(`unsupported test color ${value}`);
}

function renderedFill(value: string, css: string): Oklab {
  const canvas = parseOklch(tokenValue(css, 'surface'));
  const expression = /^color-mix\(in oklab, (.+?)\s+(\d+)%,\s+(.+)\)$/.exec(value);
  if (!expression) return opaqueColor(value, css);
  const [, sourceValue = '', shareValue = '', targetValue = ''] = expression;
  const source = opaqueColor(sourceValue, css);
  const target = targetValue === 'transparent' ? canvas : opaqueColor(targetValue, css);
  return mix(source, Number(shareValue), target);
}

function luminance({ l, a, b }: Oklab): number {
  const lm = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sm = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * lm - 3.3077115913 * mm + 0.2309699292 * sm,
    -1.2684380046 * lm + 2.6097574011 * mm - 0.3413193965 * sm,
    -0.0041960863 * lm - 0.7034186147 * mm + 1.707614701 * sm,
  ].map((channel) => Math.min(1, Math.max(0, channel)));
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Oklab, second: Oklab): number {
  const one = luminance(first);
  const two = luminance(second);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

const THEMES = Object.entries(themeSlices()) as readonly ['light' | 'dark', string][];

const RESTING_CASES: readonly {
  appearance: ScheduleItemAppearance;
  color?: string;
}[] = [
  { appearance: 'event', color: '#000000' },
  { appearance: 'event', color: '#ffffff' },
  { appearance: 'timebox', color: '#000000' },
  { appearance: 'timebox', color: '#ffffff' },
  { appearance: 'availability', color: '#000000' },
  { appearance: 'availability', color: '#ffffff' },
  { appearance: 'busy' },
];

describe('scheduling item surface palette', () => {
  it.each(THEMES.flatMap(([theme, css]) => RESTING_CASES.map((item) => ({ theme, css, ...item }))))(
    'keeps $appearance with $color AA-readable at rest in the $theme theme',
    ({ appearance, color, css }) => {
      const palette = scheduleItemSurfacePalette(appearance, color);
      expect(
        contrast(renderedFill(palette.fill, css), opaqueColor(palette.foreground, css)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(
    THEMES.flatMap(([theme, css]) =>
      (['preview', 'drop'] as const).flatMap((state) =>
        (['event', 'timebox'] as const).map((appearance) => ({
          theme,
          css,
          state,
          appearance,
        })),
      ),
    ),
  )(
    'keeps a $appearance $state state AA-readable in the $theme theme',
    ({ appearance, state, css }) => {
      const palette = scheduleItemSurfacePalette(appearance, '#ffffff', state);
      expect(
        contrast(renderedFill(palette.fill, css), opaqueColor(palette.foreground, css)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps calendar identity in a solid event fill without trusting it as the contrast base', () => {
    const palette = scheduleItemSurfacePalette('event', '#316eb4');
    expect(palette.fill).toBe('color-mix(in oklab, #316eb4 8%, var(--color-primary))');
    expect(palette.foreground).toBe('var(--color-on-primary)');
    expect(palette.fill).not.toContain('transparent');
  });
});
