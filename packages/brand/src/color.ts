/**
 * OKLCH to sRGB, so the mark's accent can be computed from the design token rather than eyeballed
 * from a colour picker.
 *
 * @remarks
 * Docket's tokens are authored in OKLCH and shift between light and dark. An installed icon is a
 * single fixed image, so it cannot reference a token — it needs a literal hex. Converting here,
 * with a test that re-reads `packages/ui/src/styles/globals.css` and checks the result, is what
 * keeps that literal honest: change `--primary` and the suite tells you the icon is stale.
 *
 * The conversion is Björn Ottosson's Oklab, published with the colour space itself, followed by
 * the standard linear-sRGB transfer function. No approximation and no dependency.
 *
 * @see {@link file://./mark.ts} for the accent it produces.
 */

/** A colour in sRGB, each channel in `[0, 1]`. */
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Whether a converted colour actually fits in sRGB, before clamping hides the fact. */
export function inGamut({ r, g, b }: Rgb): boolean {
  return [r, g, b].every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

/**
 * Convert OKLCH to linear-light sRGB.
 *
 * @param lightness - Perceptual lightness, `0` to `1`.
 * @param chroma - Chroma, typically `0` to `0.4`.
 * @param hue - Hue angle in degrees.
 * @returns Linear sRGB, unclamped so {@link inGamut} can tell whether it fit.
 */
function oklchToLinearSrgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  // Oklab's inverse: back through the cone-response space, cubed.
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** The sRGB transfer function, linear-light to encoded. */
function encode(channel: number): number {
  const clamped = Math.min(Math.max(channel, 0), 1);
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/**
 * Convert an OKLCH colour to an uppercase sRGB hex string.
 *
 * @param lightness - Perceptual lightness, `0` to `1`.
 * @param chroma - Chroma.
 * @param hue - Hue angle in degrees.
 * @returns A `#RRGGBB` string.
 *
 * @example
 * ```typescript
 * oklchToHex(0.52, 0.21, 264); // Docket's light-mode --primary
 * ```
 */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const linear = oklchToLinearSrgb(lightness, chroma, hue);
  const channels = [linear.r, linear.g, linear.b]
    .map((channel) => Math.round(encode(channel) * 255))
    .map((value) => value.toString(16).padStart(2, '0'));
  return `#${channels.join('')}`.toUpperCase();
}

/**
 * Parse an `oklch(L C H)` declaration.
 *
 * @remarks
 * Deliberately narrow: it handles the three-number form the design tokens are written in and
 * nothing else. A token that grows an alpha channel or a percentage should fail loudly here rather
 * than be silently misread into a wrong icon colour.
 *
 * @param value - The declaration text, e.g. `oklch(0.52 0.21 264)`.
 * @returns The three components.
 * @throws {Error} If the value is not that exact form.
 */
export function parseOklch(value: string): { lightness: number; chroma: number; hue: number } {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Not an oklch(L C H) value: ${value}`);
  }
  return { lightness: Number(match[1]), chroma: Number(match[2]), hue: Number(match[3]) };
}
