/**
 * `@docket/ui` — class-name utility.
 */
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge only knows Tailwind's stock font-size names (text-sm, text-lg, …). Docket's
 * named type scale (design-system.md §"Type scale") and the marketing display sizes would
 * otherwise be classified as text COLORS, making merges like
 * `cn('text-on-surface-variant text-body')` silently drop the color class.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-h1',
        'text-h2',
        'text-h3',
        'text-body',
        'text-mono',
        'text-display',
        'text-title',
      ],
    },
  },
});

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
