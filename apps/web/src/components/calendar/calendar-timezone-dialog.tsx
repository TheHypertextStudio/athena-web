'use client';

import { Globe, Search } from '@docket/ui/icons';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useEffect, useId, useMemo, useRef, useState } from 'react';

import { buildTimezoneSearchIndex, searchTimezones } from './timezone-search';

interface CalendarTimezoneDialogProps {
  readonly referenceInstant: string;
  readonly currentTimezone: string;
  readonly startTimezone: string;
  readonly endTimezone: string;
  readonly onApply: (startTimezone: string, endTimezone: string) => void;
}

function zoneLabel(zone: string): string {
  return zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone;
}

/** Focused timezone chooser with local matching by code, name, identifier, or city. */
export function CalendarTimezoneDialog({
  referenceInstant,
  currentTimezone,
  startTimezone,
  endTimezone,
  onApply,
}: CalendarTimezoneDialogProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [separate, setSeparate] = useState(startTimezone !== endTimezone);
  const [pendingStart, setPendingStart] = useState(startTimezone);
  const [pendingEnd, setPendingEnd] = useState(endTimezone);
  const [target, setTarget] = useState<'start' | 'end'>('start');
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const entries = useMemo(() => buildTimezoneSearchIndex(referenceInstant), [referenceInstant]);
  const results = useMemo(() => {
    if (query.trim()) return searchTimezones(entries, query, 18);
    const preferred = [pendingStart, pendingEnd, Intl.DateTimeFormat().resolvedOptions().timeZone];
    return [...entries]
      .sort((left, right) => {
        const leftRank = preferred.indexOf(left.id);
        const rightRank = preferred.indexOf(right.id);
        if (leftRank >= 0 || rightRank >= 0) {
          return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
        }
        return left.city.localeCompare(right.city);
      })
      .slice(0, 18);
  }, [entries, pendingEnd, pendingStart, query]);
  const activeEntry = results[activeIndex] ?? null;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, target]);

  function chooseTimezone(timezone: string): void {
    if (target === 'start') {
      setPendingStart(timezone);
      if (!separate) setPendingEnd(timezone);
    } else {
      setPendingEnd(timezone);
    }
  }

  function resetPending(next: boolean): void {
    if (next) {
      setPendingStart(startTimezone);
      setPendingEnd(endTimezone);
      setSeparate(startTimezone !== endTimezone);
      setTarget('start');
      setQuery('');
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={resetPending}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          resetPending(true);
        }}
      >
        <Globe aria-hidden="true" />
        Time zone
      </Button>
      <DialogContent
        className="max-w-md gap-4"
        aria-label="Event time zone"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <DialogTitle>Event time zone</DialogTitle>
        <DialogDescription className="sr-only">
          Search by time zone code, name, identifier, or city.
        </DialogDescription>

        <label className="text-body-medium flex items-center gap-2 py-1">
          <Checkbox
            checked={separate}
            onChange={(event) => {
              const next = event.target.checked;
              setSeparate(next);
              if (!next) setPendingEnd(pendingStart);
            }}
          />
          Use separate start and end time zones
        </label>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Time zone field">
          <Button
            type="button"
            variant={target === 'start' ? 'secondary' : 'outline'}
            className="h-auto min-w-0 justify-start px-3 py-2 text-left"
            onClick={() => {
              setTarget('start');
            }}
          >
            <span className="min-w-0">
              <span className="text-label-small text-on-surface-variant block">Starts</span>
              <span className="block truncate">{zoneLabel(pendingStart)}</span>
            </span>
          </Button>
          <Button
            type="button"
            variant={target === 'end' ? 'secondary' : 'outline'}
            disabled={!separate}
            className="h-auto min-w-0 justify-start px-3 py-2 text-left"
            onClick={() => {
              setTarget('end');
            }}
          >
            <span className="min-w-0">
              <span className="text-label-small text-on-surface-variant block">Ends</span>
              <span className="block truncate">
                {zoneLabel(separate ? pendingEnd : pendingStart)}
              </span>
            </span>
          </Button>
        </div>

        <label className="relative block">
          <span className="sr-only">Search time zones</span>
          <Search
            aria-hidden="true"
            className="text-on-surface-variant pointer-events-none absolute top-2.5 left-3 size-4"
          />
          <Input
            value={query}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeEntry ? `${listboxId}-${activeIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setActiveIndex(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setActiveIndex(Math.max(results.length - 1, 0));
              } else if (event.key === 'Enter' && activeEntry) {
                event.preventDefault();
                chooseTimezone(activeEntry.id);
              }
            }}
            placeholder="Search code, name, city, or IANA zone"
            className="pl-9"
          />
        </label>

        <div
          id={listboxId}
          role="listbox"
          aria-label={`${target === 'start' ? 'Start' : 'End'} time zones`}
          className="border-outline-variant max-h-64 overflow-y-auto rounded-lg border"
        >
          {results.map((entry, index) => {
            const selected = (target === 'start' ? pendingStart : pendingEnd) === entry.id;
            return (
              <button
                key={entry.id}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className="hover:bg-surface-container-high focus-visible:ring-ring aria-selected:bg-secondary-container flex w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                onMouseMove={() => {
                  setActiveIndex(index);
                }}
                onClick={() => {
                  chooseTimezone(entry.id);
                }}
              >
                <span className="min-w-0">
                  <span className="text-body-medium block truncate">
                    {entry.city} · {entry.commonName}
                  </span>
                  <span className="text-body-small text-on-surface-variant block truncate">
                    {entry.id}
                  </span>
                </span>
                <span className="text-body-small text-on-surface-variant shrink-0">
                  {entry.offsetLabel} · {entry.abbreviation}
                </span>
              </button>
            );
          })}
        </div>

        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {results.length} time zones. {activeEntry ? `${activeEntry.city}, ${activeEntry.id}` : ''}
        </span>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setPendingStart(currentTimezone);
              setPendingEnd(currentTimezone);
              setSeparate(false);
              setTarget('start');
              setQuery('');
            }}
          >
            Use current time zone
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              resetPending(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(pendingStart, separate ? pendingEnd : pendingStart);
              resetPending(false);
            }}
          >
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
