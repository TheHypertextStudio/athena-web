'use client';

import type { EntityDisplayColorKey, EntityDisplayIconKey, EntityDisplayOut } from '@docket/types';
import {
  SearchRounded,
  STRATEGIC_WORK_ROUNDED_ICON_BY_KEY,
  STRATEGIC_WORK_ROUNDED_ICON_OPTIONS,
} from '@docket/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useMemo, useState } from 'react';

const COLOR_OPTIONS: readonly {
  key: EntityDisplayColorKey;
  label: string;
  iconClass: string;
  circleClass: string;
  swatchClass: string;
}[] = [
  {
    key: 'neutral',
    label: 'Neutral',
    iconClass: 'text-on-surface-variant',
    circleClass: 'bg-surface-container-highest',
    swatchClass: 'bg-on-surface-variant',
  },
  {
    key: 'primary',
    label: 'Primary',
    iconClass: 'text-on-primary-container',
    circleClass: 'bg-primary-container',
    swatchClass: 'bg-primary',
  },
  {
    key: 'success',
    label: 'Success',
    iconClass: 'text-state-completed',
    circleClass: 'bg-state-completed/15',
    swatchClass: 'bg-state-completed',
  },
  {
    key: 'warning',
    label: 'Warning',
    iconClass: 'text-state-canceled',
    circleClass: 'bg-state-canceled/15',
    swatchClass: 'bg-state-canceled',
  },
  {
    key: 'danger',
    label: 'Danger',
    iconClass: 'text-destructive',
    circleClass: 'bg-destructive/15',
    swatchClass: 'bg-destructive',
  },
  {
    key: 'blue',
    label: 'Blue',
    iconClass: 'text-blue-600 dark:text-blue-300',
    circleClass: 'bg-blue-500/15',
    swatchClass: 'bg-blue-500',
  },
  {
    key: 'sky',
    label: 'Sky',
    iconClass: 'text-sky-600 dark:text-sky-300',
    circleClass: 'bg-sky-500/15',
    swatchClass: 'bg-sky-500',
  },
  {
    key: 'teal',
    label: 'Teal',
    iconClass: 'text-teal-600 dark:text-teal-300',
    circleClass: 'bg-teal-500/15',
    swatchClass: 'bg-teal-500',
  },
  {
    key: 'green',
    label: 'Green',
    iconClass: 'text-green-600 dark:text-green-300',
    circleClass: 'bg-green-500/15',
    swatchClass: 'bg-green-500',
  },
  {
    key: 'amber',
    label: 'Amber',
    iconClass: 'text-amber-600 dark:text-amber-300',
    circleClass: 'bg-amber-500/15',
    swatchClass: 'bg-amber-500',
  },
  {
    key: 'orange',
    label: 'Orange',
    iconClass: 'text-orange-600 dark:text-orange-300',
    circleClass: 'bg-orange-500/15',
    swatchClass: 'bg-orange-500',
  },
  {
    key: 'rose',
    label: 'Rose',
    iconClass: 'text-rose-600 dark:text-rose-300',
    circleClass: 'bg-rose-500/15',
    swatchClass: 'bg-rose-500',
  },
  {
    key: 'purple',
    label: 'Purple',
    iconClass: 'text-purple-600 dark:text-purple-300',
    circleClass: 'bg-purple-500/15',
    swatchClass: 'bg-purple-500',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    iconClass: 'text-indigo-600 dark:text-indigo-300',
    circleClass: 'bg-indigo-500/15',
    swatchClass: 'bg-indigo-500',
  },
];

const COLOR_BY_KEY = Object.fromEntries(
  COLOR_OPTIONS.map((option) => [option.key, option]),
) as Record<EntityDisplayColorKey, (typeof COLOR_OPTIONS)[number]>;

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
 * The presentational core shared by {@link InitiativeIconPicker}'s read-only branch and by any
 * surface (e.g. Program) that shows an entity glyph without an editing affordance. A custom hex
 * color, when present, wins over the preset color key.
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
  const color = COLOR_BY_KEY[colorKey];
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

/** Props for the anchored Initiative icon and color picker. */
export interface InitiativeIconPickerProps {
  display: EntityDisplayOut;
  initiativeName: string;
  editable: boolean;
  pending: boolean;
  onChange: (
    iconKey: EntityDisplayIconKey,
    colorKey: EntityDisplayColorKey,
    customColor: string | null,
  ) => void;
}

/** Render a stable Initiative glyph and, when editable, its anchored customization popover. */
export function InitiativeIconPicker({
  display,
  initiativeName,
  editable,
  pending,
  onChange,
}: InitiativeIconPickerProps): JSX.Element {
  const [search, setSearch] = useState('');
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return STRATEGIC_WORK_ROUNDED_ICON_OPTIONS;
    return STRATEGIC_WORK_ROUNDED_ICON_OPTIONS.filter((option) =>
      [option.label, ...option.keywords].some((value) => value.toLowerCase().includes(query)),
    );
  }, [search]);
  const hasCustomColor = display.customColor !== null;
  const glyph = (
    <EntityIconGlyph
      iconKey={display.iconKey}
      colorKey={display.colorKey}
      customColor={display.customColor}
    />
  );

  if (!editable) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center" title={initiativeName}>
        {glyph}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-surface-container-high focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Customize ${initiativeName} icon`}
          disabled={pending}
        >
          {glyph}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[21rem] p-3">
        <p className="text-on-surface mb-2 text-sm font-medium">Icon</p>
        <label className="relative mb-2 block">
          <SearchRounded
            aria-hidden
            className="text-on-surface-variant pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <input
            type="search"
            aria-label="Search icons"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search icons"
            className="border-input bg-surface focus-visible:ring-ring h-10 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <div
          aria-label="Initiative icon"
          className="grid max-h-48 grid-cols-7 gap-0.5 overflow-y-auto pr-1"
        >
          {filteredOptions.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                data-testid="initiative-icon-option"
                aria-label={option.label}
                aria-pressed={display.iconKey === option.key}
                className={cn(
                  'hover:bg-surface-container-high focus-visible:ring-ring flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none',
                  display.iconKey === option.key && 'bg-surface-container-highest',
                )}
                onClick={() => {
                  onChange(option.key, display.colorKey, display.customColor);
                }}
              >
                <OptionIcon aria-hidden className="size-4" />
              </button>
            );
          })}
        </div>
        {filteredOptions.length === 0 ? (
          <p className="text-on-surface-variant py-4 text-center text-sm">No matching icons</p>
        ) : null}
        <p className="text-on-surface mt-3 mb-2 text-sm font-medium">Color</p>
        <div aria-label="Initiative color" className="flex flex-wrap gap-1">
          {COLOR_OPTIONS.map((option) => {
            const selected = display.customColor === null && display.colorKey === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-label={option.label}
                aria-pressed={selected}
                className={cn(
                  'hover:bg-surface-container-high focus-visible:ring-ring flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none',
                  selected && 'bg-surface-container-highest',
                )}
                onClick={() => {
                  onChange(display.iconKey, option.key, null);
                }}
              >
                <span aria-hidden className={cn('size-4 rounded-full', option.swatchClass)} />
              </button>
            );
          })}
          <label
            className={cn(
              'hover:bg-surface-container-high focus-within:ring-ring relative flex size-10 cursor-pointer items-center justify-center rounded-md focus-within:ring-2',
              hasCustomColor && 'bg-surface-container-highest',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-4 rounded-full',
                !hasCustomColor && 'border-on-surface-variant border border-dashed',
              )}
              style={
                hasCustomColor ? { backgroundColor: display.customColor ?? undefined } : undefined
              }
            />
            <input
              type="color"
              aria-label="Custom color"
              value={display.customColor ?? '#3b82f6'}
              onChange={(event) => {
                onChange(display.iconKey, display.colorKey, event.target.value);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
