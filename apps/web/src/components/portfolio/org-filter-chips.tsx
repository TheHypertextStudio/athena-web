'use client';

/**
 * The org focus chips for the Hub Portfolio — a toggleable filter set that highlights one
 * tenant's swimlane and dims the rest, *without* removing any work from the roadmap.
 *
 * @remarks
 * The portfolio is a cross-org surface, so the natural "members" to filter by are the orgs
 * whose swimlanes are present. Activating a chip focuses that org (its swimlane stays at full
 * emphasis while the others fade), so the caller can isolate one tenant's roadmap at a glance
 * and still keep the full cross-org picture in view — the chips highlight/dim, they never
 * merge or hide data. Activating the already-active chip clears the focus. Each chip carries
 * the org's deterministic accent dot (the same one the rail + {@link OrgChip} use) so the
 * filter reads consistently with the swimlane it controls. The set is keyboard-navigable and
 * exposes its pressed state via `aria-pressed`.
 */
import { cn } from '@docket/ui';
import { getOrgAccent } from '@docket/ui/lib/org-accent';
import type { JSX } from 'react';

/** A focusable org in the chip set. */
export interface OrgFilterOption {
  /** The org's id (drives the accent dot + focus key). */
  readonly id: string;
  /** The org's display name. */
  readonly name: string;
  /** How many project bars this org contributes (the trailing count). */
  readonly count: number;
}

/** Props for {@link OrgFilterChips}. */
export interface OrgFilterChipsProps {
  /** The orgs present in the portfolio, in swimlane order. */
  options: readonly OrgFilterOption[];
  /** The currently focused org id, or null when no org is focused (all at full emphasis). */
  focusedOrgId: string | null;
  /** Called with an org id to focus, or null to clear the focus. */
  onFocus: (orgId: string | null) => void;
}

/**
 * The org focus chip set.
 *
 * @param props - The {@link OrgFilterChipsProps}.
 * @returns the rendered chip row, or an empty fragment when there is nothing to filter.
 */
export function OrgFilterChips({
  options,
  focusedOrgId,
  onFocus,
}: OrgFilterChipsProps): JSX.Element | null {
  // A single org needs no focus control — there is nothing to dim against it.
  if (options.length < 2) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Focus an organization"
    >
      {options.map((option) => {
        const active = focusedOrgId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onFocus(active ? null : option.id);
            }}
            className={cn(
              'focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              active
                ? 'border-foreground/20 bg-accent text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: getOrgAccent(option.id) }}
            />
            <span className="max-w-[12rem] truncate">{option.name}</span>
            <span className="text-muted-foreground tabular-nums">{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}
