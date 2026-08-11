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
import { type JSX, useMemo, useState } from 'react';

import { buildTimezoneSearchIndex, searchTimezones } from './timezone-search';

interface CalendarTimezoneDialogProps {
  readonly referenceInstant: string;
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
      <DialogContent className="max-w-md gap-4" aria-label="Event time zone">
        <DialogTitle>Event time zone</DialogTitle>
        <DialogDescription className="sr-only">
          Search by time zone code, name, identifier, or city.
        </DialogDescription>

        <label className="flex items-center gap-2 py-1 text-sm">
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
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search code, name, city, or IANA zone"
            className="pl-9"
          />
        </label>

        <div className="border-outline-variant max-h-64 overflow-y-auto rounded-lg border">
          {results.map((entry) => {
            const selected = (target === 'start' ? pendingStart : pendingEnd) === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={selected}
                className="hover:bg-surface-container-high focus-visible:ring-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => {
                  if (target === 'start') {
                    setPendingStart(entry.id);
                    if (!separate) setPendingEnd(entry.id);
                  } else {
                    setPendingEnd(entry.id);
                  }
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {entry.city} · {entry.commonName}
                  </span>
                  <span className="text-on-surface-variant block truncate text-xs">{entry.id}</span>
                </span>
                <span className="text-on-surface-variant shrink-0 text-xs">
                  {entry.offsetLabel} · {entry.abbreviation}
                </span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
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
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
