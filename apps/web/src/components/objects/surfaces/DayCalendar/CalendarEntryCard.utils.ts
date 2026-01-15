import type { CalendarEntry } from './types';

const DEFAULT_ENTRY_COLOR = '#5f6368';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result?.[1] || !result[2] || !result[3]) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

function getLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function getEntryColor(entry: Pick<CalendarEntry, 'color' | 'accountColor'>): string {
  return entry.color ?? entry.accountColor ?? DEFAULT_ENTRY_COLOR;
}

export function shouldUseDarkText(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  return luminance > 0.179;
}
