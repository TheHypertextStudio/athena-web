'use client';

/** Shared canonical work-location strip for Agenda and Calendar. */
import type {
  WorkLocationPointOut,
  WorkLocationRangeOut,
  WorkLocationSyncAccountOut,
} from '@docket/types';
import type { JSX } from 'react';

import { useApiListQuery, useApiQuery } from '@/lib/query';

import {
  workLocationPointDef,
  workLocationRangeDef,
  workLocationSyncDef,
} from './work-location-data';

/** Legacy provider context retained until canonical bootstrap is ready. */
export interface LegacyWorkLocationContext {
  readonly id: string;
  readonly label: string;
  readonly color: string | null;
}

/** One compact visual fact in the work-location strip. */
export interface WorkLocationStripChip {
  readonly id: string;
  readonly kind: 'current' | 'expected' | 'legacy' | 'warning';
  readonly label: string;
  readonly detail: string;
  readonly color: string | null;
}

/** The minimal account state required by the strip model. */
type StripAccount = Pick<
  WorkLocationSyncAccountOut,
  'provider' | 'state' | 'reason' | 'accountLabel' | 'pendingWrites'
>;

/** Inputs to the pure shared strip presentation model. */
export interface WorkLocationStripModelInput {
  readonly ready: boolean;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly point: WorkLocationPointOut | null;
  readonly range: WorkLocationRangeOut | null;
  readonly accounts: readonly StripAccount[];
  readonly legacyItems: readonly LegacyWorkLocationContext[];
}

/** Render an instant as compact local wall-clock time. */
function timeLabel(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(instant));
}

interface LocalDayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** Read stable numeric local date/time fields without depending on the viewer's locale. */
function localDayParts(instant: string, timezone: string): LocalDayParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

/** Whether a segment spans exactly one civil day, including DST-short or DST-long days. */
function isFullLocalDay(start: string, end: string, timezone: string): boolean {
  const startParts = localDayParts(start, timezone);
  const endParts = localDayParts(end, timezone);
  if (
    startParts.hour !== 0 ||
    startParts.minute !== 0 ||
    endParts.hour !== 0 ||
    endParts.minute !== 0
  ) {
    return false;
  }
  const next = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + 1));
  return (
    endParts.year === next.getUTCFullYear() &&
    endParts.month === next.getUTCMonth() + 1 &&
    endParts.day === next.getUTCDate()
  );
}

/** Application-owned provider sync warning copy. */
function accountWarning(account: StripAccount): string | null {
  const provider = account.provider === 'google' ? 'Google' : account.provider;
  if (account.state === 'action_required' || account.state === 'unsupported') {
    return `${provider} location sync needs attention`;
  }
  if (account.state === 'retrying') return `${provider} location sync is retrying`;
  if (account.pendingWrites > 0) return `${provider} location changes are syncing`;
  return null;
}

/**
 * Build the identical canonical work-location presentation used by Agenda and Calendar.
 *
 * @remarks
 * Legacy Google context is deliberately retained until every linked account has reached a rollout
 * terminal state. Once ready, only canonical current/expected answers render, with provenance and
 * confidence preserved in each chip's detail text.
 */
export function buildWorkLocationStripModel(
  input: WorkLocationStripModelInput,
): WorkLocationStripChip[] {
  const chips: WorkLocationStripChip[] = input.ready
    ? []
    : input.legacyItems.map((item) => ({
        id: item.id,
        kind: 'legacy' as const,
        label: item.label,
        detail: 'Google Calendar working location',
        color: item.color,
      }));

  if (input.ready) {
    const at = input.point ? Date.parse(input.point.at) : Number.NaN;
    if (input.point?.current.place && at >= Date.parse(input.start) && at < Date.parse(input.end)) {
      chips.push({
        id: `current:${input.point.current.place.id}`,
        kind: 'current',
        label: `Now: ${input.point.current.place.name}`,
        detail: `${input.point.current.source} · ${input.point.current.confidence}`,
        color: null,
      });
    }
    for (const segment of input.range?.segments ?? []) {
      if (!segment.place) continue;
      chips.push({
        id: `expected:${segment.effectiveStart}:${segment.place.id}`,
        kind: 'expected',
        label: isFullLocalDay(segment.effectiveStart, segment.effectiveEnd, input.timezone)
          ? `All day · ${segment.place.name}`
          : `${timeLabel(segment.effectiveStart, input.timezone)}–${timeLabel(segment.effectiveEnd, input.timezone)} · ${segment.place.name}`,
        detail: `${segment.source} · ${segment.confidence}`,
        color: null,
      });
    }
  }

  for (const account of input.accounts) {
    const label = accountWarning(account);
    if (!label) continue;
    chips.push({
      id: `warning:${account.provider}:${account.accountLabel ?? 'account'}`,
      kind: 'warning',
      label,
      detail: account.reason ?? 'pending_delivery',
      color: null,
    });
  }
  return chips;
}

/** Props for the shared live strip. */
export interface WorkLocationStripProps {
  readonly start: string;
  readonly end: string;
  readonly at: string;
  readonly timezone: string;
  readonly legacyItems?: readonly LegacyWorkLocationContext[];
  readonly className?: string;
}

/** Render canonical current/expected locations and compact provider delivery state. */
export function WorkLocationStrip({
  start,
  end,
  at,
  timezone,
  legacyItems = [],
  className = '',
}: WorkLocationStripProps): JSX.Element | null {
  const sync = useApiQuery(workLocationSyncDef());
  const range = useApiListQuery({
    ...workLocationRangeDef(start, end),
    enabled: sync.data?.ready === true,
  });
  const point = useApiQuery({
    ...workLocationPointDef(at),
    enabled:
      sync.data?.ready === true &&
      Date.parse(at) >= Date.parse(start) &&
      Date.parse(at) < Date.parse(end),
  });
  const chips = buildWorkLocationStripModel({
    ready: sync.data?.ready === true,
    start,
    end,
    timezone,
    point: point.data ?? null,
    range: range.data ?? null,
    accounts: sync.data?.accounts ?? [],
    legacyItems,
  });
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Work location"
      className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
    >
      {chips.map((chip) => (
        <span
          key={chip.id}
          title={chip.detail}
          data-work-location-kind={chip.kind}
          className={
            chip.kind === 'warning'
              ? 'bg-warning-container text-on-warning-container text-label-medium inline-flex min-w-0 items-center rounded-full px-2.5 py-1'
              : 'bg-surface-container-high text-label-medium text-on-surface inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1'
          }
        >
          {chip.kind !== 'warning' ? (
            <span
              aria-hidden="true"
              className="bg-primary size-1.5 shrink-0 rounded-full"
              style={chip.color ? { backgroundColor: chip.color } : undefined}
            />
          ) : null}
          <span className="truncate">{chip.label}</span>
        </span>
      ))}
    </div>
  );
}
