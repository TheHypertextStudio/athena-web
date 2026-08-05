/**
 * Contract test for {@link import('../../src/components/scheduling/scheduling-item-surface')}.
 *
 * @remarks
 * The requirement this guards is not "the fill uses a token" — it is a *measured* separation. A
 * design review measured the previous fill at **1.04:1** in light and **1.16:1** in dark against the
 * empty canvas and concluded that events, on the surface whose whole job is to show events, were the
 * least visible objects on screen.
 *
 * So this test does the arithmetic rather than matching a class name. It reads the real theme tokens
 * out of `packages/ui/src/styles/globals.css`, evaluates the module's own `color-mix()` expressions
 * against them, converts to sRGB and computes the WCAG contrast ratio. Change a token, change a
 * share, or swap the expression for something that only looks right, and this fails with the number.
 *
 * The `oklch` → `oklab` → linear-sRGB conversions are the CSS Color 4 formulas; they are here rather
 * than in a helper because a test that imports its own oracle from the code under test proves
 * nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SCHEDULE_ITEM_FILL,
  scheduleItemFill,
  scheduleItemRaisedFill,
  scheduleItemStripe,
} from '../../src/components/scheduling/scheduling-item-surface';

const GLOBALS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/ui/src/styles/globals.css',
);

/** An Oklab colour: perceptual lightness plus the two opponent axes. */
interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

/** Parse `oklch(L C H)` into Oklab, which is the space `color-mix(in oklab, …)` interpolates in. */
function parseOklch(value: string): Oklab {
  const inner = /oklch\(([^)]+)\)/.exec(value)?.[1] ?? '';
  const [l = 0, c = 0, h = 0] = inner.trim().split(/\s+/).map(Number);
  const radians = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(radians), b: c * Math.sin(radians) };
}

/** Read one custom property from a slice of CSS. */
function token(css: string, name: string): string {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found`);
  return value.trim();
}

/** The light and dark halves of the theme sheet, split at the dark media query. */
function themeSlices(): { readonly light: string; readonly dark: string } {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const darkAt = css.indexOf('prefers-color-scheme: dark');
  if (darkAt < 0) throw new Error('dark theme block not found');
  return { light: css.slice(0, darkAt), dark: css.slice(darkAt) };
}

/** WCAG relative luminance of an Oklab colour. */
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

/** WCAG contrast ratio between two Oklab colours. */
function contrast(first: Oklab, second: Oklab): number {
  const one = luminance(first);
  const two = luminance(second);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** Interpolate two Oklab colours the way `color-mix(in oklab, first p%, second)` does. */
function mix(first: Oklab, share: number, second: Oklab): Oklab {
  const weight = share / 100;
  return {
    l: first.l * weight + second.l * (1 - weight),
    a: first.a * weight + second.a * (1 - weight),
    b: first.b * weight + second.b * (1 - weight),
  };
}

/** The share of `--color-on-surface` the module's neutral fill declares. */
function neutralShare(): number {
  const match = /var\(--color-on-surface\)\s+(\d+)%/.exec(SCHEDULE_ITEM_FILL);
  if (!match) throw new Error(`could not read the neutral share from "${SCHEDULE_ITEM_FILL}"`);
  return Number(match[1]);
}

/** The extra share folded in by the hover / focus step. */
function raiseShare(): number {
  const match = /var\(--color-on-surface\)\s+(\d+)%/.exec(scheduleItemRaisedFill());
  if (!match) throw new Error('could not read the raise share');
  return Number(match[1]);
}

/** Evaluate the resting fill and the canvas in one theme. */
function themeColors(slice: string): { readonly canvas: Oklab; readonly fill: Oklab } {
  const canvas = parseOklch(token(slice, 'surface'));
  const onSurface = parseOklch(token(slice, 'on-surface'));
  return { canvas, fill: mix(onSurface, neutralShare(), canvas) };
}

describe('scheduling item surface', () => {
  const { light, dark } = themeSlices();

  it.each([
    { theme: 'light' as const, slice: light },
    { theme: 'dark' as const, slice: dark },
  ])('separates a resting block from the $theme canvas by at least 1.5:1', ({ slice }) => {
    const { canvas, fill } = themeColors(slice);
    const ratio = contrast(fill, canvas);

    // The measured failure was 1.04:1 (light) and 1.16:1 (dark). 1.5:1 is the floor this recipe was
    // chosen to clear in *both* themes with one expression.
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });

  it('moves the block away from the canvas in the right direction in each theme', () => {
    // Light: the canvas is the brightest tone, so a block has to go darker. Dark: the canvas is a
    // mid tone and MD3 elevation reads lighter, so a block has to go lighter. One expression does
    // both, which is the whole reason this is a mix rather than a container token.
    const lightTheme = themeColors(light);
    const darkTheme = themeColors(dark);
    expect(lightTheme.fill.l).toBeLessThan(lightTheme.canvas.l);
    expect(darkTheme.fill.l).toBeGreaterThan(darkTheme.canvas.l);
  });

  it.each([
    { theme: 'light' as const, slice: light },
    { theme: 'dark' as const, slice: dark },
  ])('keeps a block’s own label readable on the $theme fill', ({ slice }) => {
    const { fill } = themeColors(slice);
    const onSurface = parseOklch(token(slice, 'on-surface'));

    // A fill with a real tonal step is worthless if it costs the title its contrast.
    expect(contrast(onSurface, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    { theme: 'light' as const, slice: light },
    { theme: 'dark' as const, slice: dark },
  ])(
    'raises the block further from the $theme canvas on hover, never back toward it',
    ({ slice }) => {
      const { canvas, fill } = themeColors(slice);
      const onSurface = parseOklch(token(slice, 'on-surface'));
      const raised = mix(onSurface, raiseShare(), fill);

      expect(contrast(raised, canvas)).toBeGreaterThan(contrast(fill, canvas));
    },
  );

  it('lets a layer colour tint a block without erasing the tonal step', () => {
    const tinted = scheduleItemFill('#16a34a');
    const share = /#16a34a\s+(\d+)%/.exec(tinted)?.[1];

    // The neutral fill is the base of the tinted expression, so the guaranteed step survives the
    // tint; and the colour is a minority share, so no layer colour can wash it back out.
    expect(tinted).toContain(SCHEDULE_ITEM_FILL);
    expect(Number(share)).toBeLessThan(50);
  });

  it('falls back to the neutral fill and a visible stripe for an uncoloured block', () => {
    expect(scheduleItemFill()).toBe(SCHEDULE_ITEM_FILL);
    expect(scheduleItemFill('   ')).toBe(SCHEDULE_ITEM_FILL);
    // The stripe is a block's one identity marker, so an uncoloured block still gets a real one
    // rather than a hairline that disappears into the fill.
    expect(scheduleItemStripe()).toBe('var(--color-on-surface-variant)');
    expect(scheduleItemStripe('#16a34a')).toBe('#16a34a');
  });

  it('interpolates in oklab, never srgb', () => {
    // An sRGB mix of two near-neutral tones lands at a different perceived lightness than the share
    // implies — which is exactly how a "20% darker" fill ended up measuring 1.04:1.
    for (const expression of [
      SCHEDULE_ITEM_FILL,
      scheduleItemFill('#16a34a'),
      scheduleItemRaisedFill(),
    ]) {
      expect(expression).not.toContain('in srgb');
      expect(expression.startsWith('color-mix(in oklab,')).toBe(true);
    }
  });

  // CAL-17 (docs/engineering/launch-compliance.md): "event/time-block surfaces are the only elements
  // using the highest-contrast fill". Today's lane-header day chip (scheduling-canvas-header.tsx) used
  // to be a solid `bg-primary` fill — measured well above an event's own fill — which made a date
  // badge, not an event, the loudest object on the grid. It now uses `primary-container`, and this
  // pins that the tonal chip never re-outranks an event block again.
  describe.each([
    { theme: 'light' as const, slice: light },
    { theme: 'dark' as const, slice: dark },
  ])('today’s lane-header chip on the $theme canvas', ({ slice }) => {
    it('is at or below an event’s own fill contrast against the canvas', () => {
      const canvas = parseOklch(token(slice, 'surface'));
      const primaryContainer = parseOklch(token(slice, 'primary-container'));
      const { fill: eventFill } = themeColors(slice);

      const chipContrast = contrast(primaryContainer, canvas);
      const eventContrast = contrast(eventFill, canvas);

      expect(chipContrast).toBeLessThanOrEqual(eventContrast);
    });

    it('never falls back to the solid, highest-contrast primary fill', () => {
      const canvas = parseOklch(token(slice, 'surface'));
      const primary = parseOklch(token(slice, 'primary'));
      const primaryContainer = parseOklch(token(slice, 'primary-container'));

      expect(contrast(primaryContainer, canvas)).toBeLessThan(contrast(primary, canvas));
    });

    it('keeps the day number itself legible on the tonal chip', () => {
      const primaryContainer = parseOklch(token(slice, 'primary-container'));
      const onPrimaryContainer = parseOklch(token(slice, 'on-primary-container'));

      expect(contrast(onPrimaryContainer, primaryContainer)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
