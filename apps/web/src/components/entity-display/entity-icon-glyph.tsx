'use client';

/**
 * `entity-display` — the display vocabulary shared by everything that carries an
 * {@link EntityDisplayOut}: initiatives, projects, programs, and teams.
 *
 * @remarks
 * This used to live inside `initiatives/initiative-icon-picker.tsx`, which meant Programs imported
 * their glyph from the Initiatives folder. That was survivable with three consumers and stops being
 * survivable once Teams is a fourth — a team is not a kind of initiative, and an import path that
 * says it is will eventually be believed. The picker still owns the *editing* affordance; only the
 * vocabulary and the read-only glyph moved here.
 *
 * One color table serves both the glyph and the generated covers, so a team whose color is Indigo
 * has an indigo glyph and an indigo cover without either side knowing about the other.
 */
import type { EntityDisplayColorKey, EntityDisplayIconKey } from '@docket/types';
import { STRATEGIC_WORK_ROUNDED_ICON_BY_KEY } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** One preset color, resolved into the classes each surface needs. */
export interface EntityDisplayColor {
  /** The stored preset key. */
  key: EntityDisplayColorKey;
  /** The human-readable label shown in the picker. */
  label: string;
  /** Foreground class for an icon drawn in this color. */
  iconClass: string;
  /** Background class for the tinted circle behind that icon. */
  circleClass: string;
  /** Solid fill class, for a swatch or a chart series. */
  swatchClass: string;
  /** The wash a generated cover is painted with. */
  coverClass: string;
}

/** The curated preset colors, in picker order. */
export const ENTITY_DISPLAY_COLORS: readonly EntityDisplayColor[] = [
  {
    key: 'neutral',
    label: 'Neutral',
    iconClass: 'text-on-surface-variant',
    circleClass: 'bg-surface-container-highest',
    swatchClass: 'bg-on-surface-variant',
    coverClass: 'from-surface-container-highest to-surface-container',
  },
  {
    key: 'primary',
    label: 'Primary',
    iconClass: 'text-on-primary-container',
    circleClass: 'bg-primary-container',
    swatchClass: 'bg-primary',
    coverClass: 'from-primary-container to-surface-container',
  },
  {
    key: 'success',
    label: 'Success',
    iconClass: 'text-state-completed',
    circleClass: 'bg-state-completed/15',
    swatchClass: 'bg-state-completed',
    coverClass: 'from-state-completed/25 to-surface-container',
  },
  {
    key: 'warning',
    label: 'Warning',
    iconClass: 'text-state-canceled',
    circleClass: 'bg-state-canceled/15',
    swatchClass: 'bg-state-canceled',
    coverClass: 'from-state-canceled/25 to-surface-container',
  },
  {
    key: 'danger',
    label: 'Danger',
    iconClass: 'text-error',
    circleClass: 'bg-error/15',
    swatchClass: 'bg-error',
    coverClass: 'from-error/20 to-surface-container',
  },
  {
    key: 'blue',
    label: 'Blue',
    iconClass: 'text-blue-600 dark:text-blue-300',
    circleClass: 'bg-blue-500/15',
    swatchClass: 'bg-blue-500',
    coverClass: 'from-blue-500/25 to-surface-container',
  },
  {
    key: 'sky',
    label: 'Sky',
    iconClass: 'text-sky-600 dark:text-sky-300',
    circleClass: 'bg-sky-500/15',
    swatchClass: 'bg-sky-500',
    coverClass: 'from-sky-500/25 to-surface-container',
  },
  {
    key: 'teal',
    label: 'Teal',
    iconClass: 'text-teal-600 dark:text-teal-300',
    circleClass: 'bg-teal-500/15',
    swatchClass: 'bg-teal-500',
    coverClass: 'from-teal-500/25 to-surface-container',
  },
  {
    key: 'green',
    label: 'Green',
    iconClass: 'text-green-600 dark:text-green-300',
    circleClass: 'bg-green-500/15',
    swatchClass: 'bg-green-500',
    coverClass: 'from-green-500/25 to-surface-container',
  },
  {
    key: 'amber',
    label: 'Amber',
    iconClass: 'text-amber-600 dark:text-amber-300',
    circleClass: 'bg-amber-500/15',
    swatchClass: 'bg-amber-500',
    coverClass: 'from-amber-500/25 to-surface-container',
  },
  {
    key: 'orange',
    label: 'Orange',
    iconClass: 'text-orange-600 dark:text-orange-300',
    circleClass: 'bg-orange-500/15',
    swatchClass: 'bg-orange-500',
    coverClass: 'from-orange-500/25 to-surface-container',
  },
  {
    key: 'rose',
    label: 'Rose',
    iconClass: 'text-rose-600 dark:text-rose-300',
    circleClass: 'bg-rose-500/15',
    swatchClass: 'bg-rose-500',
    coverClass: 'from-rose-500/25 to-surface-container',
  },
  {
    key: 'purple',
    label: 'Purple',
    iconClass: 'text-purple-600 dark:text-purple-300',
    circleClass: 'bg-purple-500/15',
    swatchClass: 'bg-purple-500',
    coverClass: 'from-purple-500/25 to-surface-container',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    iconClass: 'text-indigo-600 dark:text-indigo-300',
    circleClass: 'bg-indigo-500/15',
    swatchClass: 'bg-indigo-500',
    coverClass: 'from-indigo-500/25 to-surface-container',
  },
];

/** The preset colors keyed for lookup. */
export const ENTITY_DISPLAY_COLOR_BY_KEY = Object.fromEntries(
  ENTITY_DISPLAY_COLORS.map((option) => [option.key, option]),
) as Record<EntityDisplayColorKey, EntityDisplayColor>;

/** Props for {@link EntityIconGlyph}. */
export interface EntityIconGlyphProps {
  /** The strategic-work icon to render. */
  iconKey: EntityDisplayIconKey;
  /** The preset color key (ignored when {@link customColor} is set). */
  colorKey: EntityDisplayColorKey;
  /** A custom hex color that overrides the preset, or `null` to use the preset. */
  customColor: string | null;
  /** The circle diameter in pixels (the icon renders at half this). Defaults to 32. */
  size?: number;
}

/**
 * The stable, non-interactive entity glyph: a tinted circle wrapping a strategic-work icon.
 *
 * @remarks
 * The presentational core shared by the icon picker's read-only branch and by any surface that
 * shows an entity glyph without an editing affordance. A custom hex color, when present, wins over
 * the preset color key.
 *
 * @param props - The {@link EntityIconGlyphProps}.
 * @returns the rendered glyph.
 */
export function EntityIconGlyph({
  iconKey,
  colorKey,
  customColor,
  size = 32,
}: EntityIconGlyphProps): JSX.Element {
  const Icon = STRATEGIC_WORK_ROUNDED_ICON_BY_KEY[iconKey];
  const color = ENTITY_DISPLAY_COLOR_BY_KEY[colorKey];
  const hasCustomColor = customColor !== null;
  const iconSize = Math.round(size * 0.5);
  return (
    <span
      data-testid="initiative-icon-circle"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        !hasCustomColor && color.circleClass,
      )}
      style={{
        width: size,
        height: size,
        ...(hasCustomColor ? { backgroundColor: `${customColor}26` } : {}),
      }}
    >
      <Icon
        aria-hidden
        data-testid="initiative-icon"
        className={cn(!hasCustomColor && color.iconClass)}
        style={{
          width: iconSize,
          height: iconSize,
          ...(hasCustomColor ? { color: customColor } : {}),
        }}
      />
    </span>
  );
}

export default EntityIconGlyph;
