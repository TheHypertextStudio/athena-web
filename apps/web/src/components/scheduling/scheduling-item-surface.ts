import type { ScheduleItemAppearance } from './scheduling-types';

/** Interaction state that can replace a scheduling item's resting surface roles. */
export type ScheduleItemSurfaceState = 'rest' | 'preview' | 'drop';

/** Matched semantic fill and foreground roles for one scheduling item surface. */
export interface ScheduleItemSurfacePalette {
  readonly fill: string;
  readonly foreground: string;
}

const CALENDAR_COLOR_SHARE = 8;

function suppliedColor(color: string | undefined, fallback: string): string {
  return color === undefined || color.trim().length === 0 ? fallback : color;
}

/**
 * Return the matched fill and foreground for one scheduling appearance and interaction state.
 *
 * @param appearance - Domain-neutral meaning of the item being rendered.
 * @param color - Optional consumer-owned calendar color.
 * @param state - Resting or transient interaction state. Defaults to `rest`.
 * @returns Semantic CSS colors that keep item content readable against the chosen fill.
 */
export function scheduleItemSurfacePalette(
  appearance: ScheduleItemAppearance,
  color?: string,
  state: ScheduleItemSurfaceState = 'rest',
): ScheduleItemSurfacePalette {
  if (state === 'preview') {
    return {
      fill: 'var(--color-surface-container-high)',
      foreground: 'var(--color-on-surface)',
    };
  }
  if (state === 'drop') {
    return {
      fill: 'var(--color-primary-container)',
      foreground: 'var(--color-on-primary-container)',
    };
  }

  switch (appearance) {
    case 'event': {
      const source = suppliedColor(color, 'var(--color-primary)');
      return {
        fill: `color-mix(in oklab, ${source} ${String(CALENDAR_COLOR_SHARE)}%, var(--color-primary))`,
        foreground: 'var(--color-on-primary)',
      };
    }
    case 'timebox': {
      const source = suppliedColor(color, 'var(--color-primary)');
      return {
        fill: `color-mix(in oklab, ${source} 14%, transparent)`,
        foreground: 'var(--color-on-surface)',
      };
    }
    case 'availability': {
      const source = suppliedColor(color, 'var(--color-tertiary)');
      return {
        fill: `color-mix(in oklab, ${source} 9%, transparent)`,
        foreground: 'var(--color-on-surface)',
      };
    }
    case 'busy':
      return {
        fill: 'color-mix(in oklab, var(--color-on-surface) 7%, transparent)',
        foreground: 'var(--color-on-surface)',
      };
  }
}
