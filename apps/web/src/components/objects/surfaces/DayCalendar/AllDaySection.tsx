'use client';

import React, { type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from './types';

/**
 * Converts a hex color to RGB values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result?.[1] || !result[2] || !result[3]) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculates relative luminance of a color for contrast checking.
 */
function getLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Determines if dark text should be used on a given background color.
 */
function shouldUseDarkText(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return getLuminance(rgb.r, rgb.g, rgb.b) > 0.179;
}

export interface AllDaySectionProps {
  entries: CalendarEntry[];
  onEntryClick?: (entry: CalendarEntry, event: MouseEvent) => void;
  onEntryContextMenu?: (entry: CalendarEntry, event: MouseEvent) => void;
}

/**
 * All-day events section displayed above the time grid.
 * Shows all-day events as horizontal pills/chips.
 */
export function AllDaySection({ entries, onEntryClick, onEntryContextMenu }: AllDaySectionProps) {
  if (entries.length === 0) return null;

  const DEFAULT_COLOR = '#5f6368';

  return (
    <div className="border-outline-variant/50 border-b px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-on-surface-variant w-12 text-right text-xs">all-day</span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {entries.map((entry) => {
            const entryColor = entry.color ?? entry.accountColor ?? DEFAULT_COLOR;
            const useDarkText = shouldUseDarkText(entryColor);

            return (
              <button
                key={entry.id}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-sm font-medium',
                  'hover:ring-primary/50 transition-shadow hover:ring-2',
                )}
                style={{ backgroundColor: entryColor }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEntryClick?.(entry, e);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEntryContextMenu?.(entry, e);
                }}
              >
                <span className={cn(useDarkText ? 'text-gray-900' : 'text-white')}>
                  {entry.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
