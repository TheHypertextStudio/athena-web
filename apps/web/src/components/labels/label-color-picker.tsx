'use client';

/**
 * The label colour swatch grid.
 *
 * @remarks
 * Ten fixed swatches, no custom picker and no hex field. That is a product decision, not a
 * shortcut: a free colour cannot be made to read correctly against both a near-white and a
 * near-black surface, and a palette also keeps a workspace's labels looking like one set rather
 * than ten people's individual taste.
 *
 * Colour is never a required decision either — inline creation assigns one by rotation, and this
 * grid only exists for the person who later wants `urgent` to be red.
 */
import { LABEL_COLOR_KEYS, type LabelColorKey } from '@docket/types';
import { Check } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** Props for {@link LabelColorPicker}. */
export interface LabelColorPickerProps {
  /** The currently-selected palette key. */
  value: LabelColorKey;
  /** Report a chosen palette key. */
  onChange: (value: LabelColorKey) => void;
  /** Accessible name for the group. */
  ariaLabel?: string;
}

/** Sentence-case a palette key for its accessible name. */
function swatchName(key: LabelColorKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Choose a label colour from the palette.
 *
 * @param props - The {@link LabelColorPickerProps}.
 * @returns The rendered swatch grid.
 */
export function LabelColorPicker({
  value,
  onChange,
  ariaLabel = 'Label colour',
}: LabelColorPickerProps): JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {LABEL_COLOR_KEYS.map((key) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatchName(key)}
            data-label-color={key}
            onClick={() => {
              onChange(key);
            }}
            className={cn(
              'flex size-7 items-center justify-center rounded-full outline-none',
              'bg-(--label-dot) transition-transform',
              'hover:scale-110 focus-visible:scale-110',
              // The ring sits on the surface rather than on the swatch, so it reads against
              // every hue instead of vanishing into the light ones.
              'focus-visible:ring-on-surface focus-visible:ring-2 focus-visible:ring-offset-2',
              'focus-visible:ring-offset-surface',
            )}
          >
            {selected ? (
              // White check on a saturated dot: the dot role is contrast-tuned to carry it in
              // both themes, which is the whole reason it is a separate role from the container.
              <Check aria-hidden="true" className="size-4 text-white" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
