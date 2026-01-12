'use client';

/**
 * Compact timezone selector for calendar header.
 *
 * Allows users to view the calendar in a different timezone
 * without changing their global preference.
 *
 * @packageDocumentation
 */

import { useState, useMemo, useCallback } from 'react';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  getTimezoneInfo,
  getTimezoneAbbreviation,
  COMMON_TIMEZONES,
  REGION_ORDER,
} from '@/lib/timezone-utils';
import { useCalendarTimezone } from '@/contexts/TimezoneContext';

interface TimezoneSelectorProps {
  className?: string;
}

export function TimezoneSelector({ className }: TimezoneSelectorProps) {
  const { timezone, globalTimezone, isOverride, setOverride, clearOverride } =
    useCalendarTimezone();
  const [open, setOpen] = useState(false);

  const currentInfo = useMemo(() => getTimezoneInfo(timezone), [timezone]);
  const abbreviation = useMemo(() => getTimezoneAbbreviation(timezone), [timezone]);

  // Group timezones by region
  const groupedTimezones = useMemo(() => {
    const groups = new Map<string, typeof COMMON_TIMEZONES>();
    for (const tz of COMMON_TIMEZONES) {
      const existing = groups.get(tz.region);
      if (existing) {
        existing.push(tz);
      } else {
        groups.set(tz.region, [tz]);
      }
    }
    return groups;
  }, []);

  const handleSelect = useCallback(
    (value: string) => {
      if (value === globalTimezone) {
        clearOverride();
      } else {
        setOverride(value);
      }
      setOpen(false);
    },
    [globalTimezone, setOverride, clearOverride],
  );

  const handleClearOverride = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clearOverride();
    },
    [clearOverride],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
            'hover:bg-surface-container-high',
            isOverride ? 'bg-tertiary/10 text-tertiary' : 'text-on-surface-variant',
            className,
          )}
          title={
            isOverride ? `Viewing in ${timezone} (click to change)` : 'View in different timezone'
          }
        >
          <LanguageOutlinedIcon sx={{ fontSize: 14 }} />
          <div className="flex flex-col items-start leading-tight">
            <span className="tabular-nums">{abbreviation}</span>
            <span className="text-on-surface-variant/70 text-[10px]">{currentInfo.offset}</span>
          </div>
          {isOverride && (
            <button
              onClick={handleClearOverride}
              className="hover:bg-tertiary/20 -mr-1 ml-0.5 rounded p-0.5"
              title="Reset to your timezone"
            >
              <CloseOutlinedIcon sx={{ fontSize: 12 }} />
            </button>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="max-h-[400px] w-[300px] overflow-y-auto" align="end">
        {/* Quick action: Reset to global timezone */}
        {isOverride && (
          <>
            <DropdownMenuItem
              onClick={() => {
                clearOverride();
                setOpen(false);
              }}
              className="text-tertiary"
            >
              Reset to your timezone ({getTimezoneAbbreviation(globalTimezone)})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Grouped timezone list */}
        {REGION_ORDER.map((region, regionIndex) => {
          const regionTimezones = groupedTimezones.get(region);
          if (!regionTimezones || regionTimezones.length === 0) return null;

          return (
            <div key={region}>
              {regionIndex > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-on-surface-variant text-xs">
                {region}
              </DropdownMenuLabel>
              {regionTimezones.map((tz) => {
                const info = getTimezoneInfo(tz.value);
                const isSelected = tz.value === timezone;

                return (
                  <DropdownMenuItem
                    key={tz.value}
                    onClick={() => {
                      handleSelect(tz.value);
                    }}
                    className={cn(
                      'flex items-center justify-between',
                      isSelected && 'bg-primary/10 text-primary',
                    )}
                  >
                    <span className="truncate">{tz.label}</span>
                    <span className="text-on-surface-variant ml-2 flex-shrink-0 text-xs tabular-nums">
                      {info.offset}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
