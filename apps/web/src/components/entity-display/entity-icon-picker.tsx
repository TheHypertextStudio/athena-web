'use client';

import type { EntityDisplayColorKey, EntityDisplayIconKey, EntityDisplayOut } from '@docket/types';
import { SearchRounded, STRATEGIC_WORK_ROUNDED_ICON_OPTIONS } from '@docket/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';

import {
  ENTITY_DISPLAY_COLORS as COLOR_OPTIONS,
  EntityIconGlyph,
} from '@/components/entity-display/entity-icon-glyph';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useMemo, useState } from 'react';

/** Props for the anchored entity icon and color picker. */
export interface EntityIconPickerProps {
  display: EntityDisplayOut;
  /** The entity's name, used for the trigger's accessible label and read-only title. */
  entityName: string;
  editable: boolean;
  pending: boolean;
  /** Visual glyph diameter; detail mastheads use 48dp while list surfaces keep 32dp. */
  size?: number;
  onChange: (
    iconKey: EntityDisplayIconKey,
    colorKey: EntityDisplayColorKey,
    customColor: string | null,
  ) => void;
}

/** Render a stable entity glyph and, when editable, its anchored customization popover. */
export function EntityIconPicker({
  display,
  entityName,
  editable,
  pending,
  size = 32,
  onChange,
}: EntityIconPickerProps): JSX.Element {
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
      size={size}
    />
  );

  if (!editable) {
    return (
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: Math.max(40, size), height: Math.max(40, size) }}
        title={entityName}
      >
        {glyph}
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-surface-container-high focus-visible:ring-ring flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          style={{ width: Math.max(40, size), height: Math.max(40, size) }}
          aria-label={`Customize ${entityName} icon`}
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
            className="border-outline bg-surface focus-visible:ring-ring h-10 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-2"
          />
        </label>
        <div
          aria-label="Entity icon"
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
        <div aria-label="Entity color" className="flex flex-wrap gap-1">
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
