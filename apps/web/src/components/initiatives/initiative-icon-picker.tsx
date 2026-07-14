'use client';

import type { EntityDisplayColorKey, EntityDisplayIconKey, EntityDisplayOut } from '@docket/types';
import {
  Flag,
  Folder,
  Globe,
  Layers,
  Sparkles,
  Target,
  Users,
  Workflow,
  type LucideIcon,
} from '@docket/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

const ICON_OPTIONS: readonly { key: EntityDisplayIconKey; label: string; icon: LucideIcon }[] = [
  { key: 'target', label: 'Target', icon: Target },
  { key: 'flag', label: 'Flag', icon: Flag },
  { key: 'layers', label: 'Layers', icon: Layers },
  { key: 'folder', label: 'Folder', icon: Folder },
  { key: 'workflow', label: 'Workflow', icon: Workflow },
  { key: 'globe', label: 'Globe', icon: Globe },
  { key: 'users', label: 'People', icon: Users },
  { key: 'sparkles', label: 'Sparkles', icon: Sparkles },
];

const ICON_BY_KEY = Object.fromEntries(
  ICON_OPTIONS.map((option) => [option.key, option.icon]),
) as Record<EntityDisplayIconKey, LucideIcon>;

const COLOR_OPTIONS: readonly {
  key: EntityDisplayColorKey;
  label: string;
  iconClass: string;
  swatchClass: string;
}[] = [
  {
    key: 'neutral',
    label: 'Neutral',
    iconClass: 'text-on-surface-variant',
    swatchClass: 'bg-on-surface-variant',
  },
  { key: 'primary', label: 'Primary', iconClass: 'text-primary', swatchClass: 'bg-primary' },
  {
    key: 'success',
    label: 'Success',
    iconClass: 'text-state-completed',
    swatchClass: 'bg-state-completed',
  },
  {
    key: 'warning',
    label: 'Warning',
    iconClass: 'text-state-canceled',
    swatchClass: 'bg-state-canceled',
  },
  { key: 'danger', label: 'Danger', iconClass: 'text-destructive', swatchClass: 'bg-destructive' },
];

const COLOR_CLASS = Object.fromEntries(
  COLOR_OPTIONS.map((option) => [option.key, option.iconClass]),
) as Record<EntityDisplayColorKey, string>;

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
  const Icon = ICON_BY_KEY[display.iconKey];
  const glyph = (
    <Icon
      aria-hidden
      data-testid="initiative-icon"
      className={cn('size-5', COLOR_CLASS[display.colorKey])}
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
          className="hover:bg-surface-container-high focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Customize ${initiativeName} icon`}
          disabled={pending}
        >
          {glyph}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <p className="text-on-surface mb-2 text-sm font-medium">Icon</p>
        <div aria-label="Initiative icon" className="grid grid-cols-4 gap-1">
          {ICON_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
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
                <OptionIcon aria-hidden className="size-5" />
              </button>
            );
          })}
        </div>
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
