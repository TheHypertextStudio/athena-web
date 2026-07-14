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
];

const COLOR_BY_KEY = Object.fromEntries(
  COLOR_OPTIONS.map((option) => [option.key, option]),
) as Record<EntityDisplayColorKey, (typeof COLOR_OPTIONS)[number]>;

/** Props for the anchored Initiative icon and color picker. */
export interface InitiativeIconPickerProps {
  display: EntityDisplayOut;
  initiativeName: string;
  editable: boolean;
  pending: boolean;
  onChange: (iconKey: EntityDisplayIconKey, colorKey: EntityDisplayColorKey) => void;
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
  const Icon = STRATEGIC_WORK_ROUNDED_ICON_BY_KEY[display.iconKey];
  const color = COLOR_BY_KEY[display.colorKey];
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return STRATEGIC_WORK_ROUNDED_ICON_OPTIONS;
    return STRATEGIC_WORK_ROUNDED_ICON_OPTIONS.filter((option) =>
      [option.label, ...option.keywords].some((value) => value.toLowerCase().includes(query)),
    );
  }, [search]);
  const glyph = (
    <span
      data-testid="initiative-icon-circle"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        color.circleClass,
      )}
    >
      <Icon aria-hidden data-testid="initiative-icon" className={cn('size-5', color.iconClass)} />
    </span>
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
                  onChange(option.key, display.colorKey);
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
        <div aria-label="Initiative color" className="flex gap-1">
          {COLOR_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-label={option.label}
              aria-pressed={display.colorKey === option.key}
              className={cn(
                'hover:bg-surface-container-high focus-visible:ring-ring flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none',
                display.colorKey === option.key && 'bg-surface-container-highest',
              )}
              onClick={() => {
                onChange(display.iconKey, option.key);
              }}
            >
              <span aria-hidden className={cn('size-4 rounded-full', option.swatchClass)} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
