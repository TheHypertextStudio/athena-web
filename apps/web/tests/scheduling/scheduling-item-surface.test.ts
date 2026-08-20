import { describe, expect, it } from 'vitest';

import { scheduleItemSurfacePalette } from '../../src/components/scheduling/scheduling-item-surface';
import type { ScheduleItemAppearance } from '../../src/components/scheduling/scheduling-types';
import {
  SCHEDULE_TEST_THEMES,
  scheduleSurfaceContrast,
} from './scheduling-surface-contrast-test-utils';

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
  it.each(
    SCHEDULE_TEST_THEMES.flatMap((theme) => RESTING_CASES.map((item) => ({ theme, ...item }))),
  )(
    'keeps $appearance with $color AA-readable at rest in the $theme theme',
    ({ appearance, color, theme }) => {
      const palette = scheduleItemSurfacePalette(appearance, color);
      expect(
        scheduleSurfaceContrast(palette.fill, palette.foreground, theme),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(
    SCHEDULE_TEST_THEMES.flatMap((theme) =>
      (['preview', 'drop'] as const).flatMap((state) =>
        (['event', 'timebox'] as const).map((appearance) => ({
          theme,
          state,
          appearance,
        })),
      ),
    ),
  )(
    'keeps a $appearance $state state AA-readable in the $theme theme',
    ({ appearance, state, theme }) => {
      const palette = scheduleItemSurfacePalette(appearance, '#ffffff', state);
      expect(
        scheduleSurfaceContrast(palette.fill, palette.foreground, theme),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(
    SCHEDULE_TEST_THEMES.flatMap((theme) =>
      RESTING_CASES.map((item) => ({ theme, state: 'rest' as const, ...item })),
    ),
  )(
    'keeps the $appearance focus indicator distinguishable with $color in the $theme theme',
    ({ appearance, color, state, theme }) => {
      const palette = scheduleItemSurfacePalette(appearance, color, state);
      expect(palette.focusIndicator).toBeDefined();
      expect(
        scheduleSurfaceContrast(palette.fill, palette.focusIndicator, theme),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it('keeps calendar identity in a solid event fill without trusting it as the contrast base', () => {
    const palette = scheduleItemSurfacePalette('event', '#316eb4');
    expect(palette.fill).toBe('color-mix(in oklab, #316eb4 8%, var(--color-primary))');
    expect(palette.foreground).toBe('var(--color-on-primary)');
    expect(palette.fill).not.toContain('transparent');
  });
});
