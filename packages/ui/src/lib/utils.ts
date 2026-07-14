/**
 * `@docket/ui` — class-name utility.
 */
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge only knows Tailwind's stock font-size names (text-sm, text-lg, …). Docket's
 * MD3 type scale (design-system.md §"Type scale") would
 * otherwise be classified as text COLORS, making merges like
 * `cn('text-on-surface-variant text-body-medium')` silently drop the color class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-display-large',
        'text-display-medium',
        'text-display-small',
        'text-headline-large',
        'text-headline-medium',
        'text-headline-small',
        'text-title-large',
        'text-title-medium',
        'text-title-small',
        'text-body-large',
        'text-body-medium',
        'text-body-small',
        'text-label-large',
        'text-label-medium',
        'text-label-small',
      ],
    },
  },
});

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
