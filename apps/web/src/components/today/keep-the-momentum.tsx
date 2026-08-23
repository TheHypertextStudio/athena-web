'use client';

import type { HubTodaySuggestion } from '@docket/types';
import { ArrowRight, Play, Plus, Sparkles, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useMemo, useState } from 'react';

import { OrgChip } from '@/components/org-chip';

/** Props for the cleared-day Athena suggestions. */
export interface KeepTheMomentumProps {
  readonly suggestions: readonly HubTodaySuggestion[];
  readonly orgName: (organizationId: string) => string;
  readonly onAdd: (suggestion: HubTodaySuggestion) => void;
  readonly onStart: (suggestion: HubTodaySuggestion) => void;
  readonly onAskAthena?: () => void;
  readonly busy?: boolean;
  readonly blockedPlan?: boolean;
}

/** Offer only grounded work that the server established can fit the remaining day. */
export default function KeepTheMomentum({
  suggestions,
  orgName,
  onAdd,
  onStart,
  onAskAthena,
  busy = false,
  blockedPlan = false,
}: KeepTheMomentumProps): JSX.Element {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(
    () => suggestions.filter((item) => !dismissed.has(item.id)).slice(0, 3),
    [suggestions, dismissed],
  );
  return (
    <section
      aria-labelledby="momentum-heading"
      className="border-primary/20 bg-primary/4 rounded-2xl border p-5"
    >
      <div className="flex items-start gap-3">
        <span className="bg-primary/12 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h2 id="momentum-heading" className="text-on-surface text-title-large">
            Keep the momentum
          </h2>
          <p className="text-on-surface-variant text-body-medium mt-0.5">
            {blockedPlan
              ? 'Your remaining plan is blocked. Athena found work that can genuinely fit while you wait.'
              : 'Your plan is clear. Athena found work that can genuinely fit the time left.'}
          </p>
        </div>
      </div>
      {visible.length > 0 ? (
        <ul className="divide-outline-variant/70 mt-4 divide-y">
          {visible.map((suggestion) => (
            <li key={suggestion.id} className="py-4 first:pt-2 last:pb-0">
              <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/orgs/${suggestion.organizationId}/tasks/${suggestion.id}`}
                      className="text-on-surface text-title-small focus-visible:ring-ring hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {suggestion.title}
                    </Link>
                    <OrgChip
                      orgId={suggestion.organizationId}
                      name={orgName(suggestion.organizationId)}
                    />
                  </div>
                  <p className="text-on-surface-variant text-body-small mt-1">
                    {suggestion.reason} · {String(suggestion.estimateMinutes)} min
                  </p>
                </div>
                <div className="flex min-h-11 flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    controlSize="sm"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => {
                      onStart(suggestion);
                    }}
                  >
                    <Play aria-hidden="true" /> Start now
                  </Button>
                  <Button
                    type="button"
                    controlSize="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => {
                      onAdd(suggestion);
                    }}
                  >
                    <Plus aria-hidden="true" /> Add to today
                  </Button>
                  <Button
                    asChild
                    controlSize="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Open task"
                    className="min-h-11 min-w-11"
                  >
                    <Link href={`/orgs/${suggestion.organizationId}/tasks/${suggestion.id}`}>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    controlSize="sm"
                    variant="ghost"
                    iconOnly
                    aria-label="Dismiss"
                    className="min-h-11 min-w-11"
                    onClick={() => {
                      setDismissed((current) => new Set([...current, suggestion.id]));
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 pl-12">
          <p className="text-on-surface text-body-medium">
            {blockedPlan ? 'Nothing else fits around the block.' : 'You’re clear.'}
          </p>
          <p className="text-on-surface-variant text-body-small mt-1">
            {blockedPlan
              ? 'Open the task to resolve what is blocking it, or ask Athena to reshape the plan.'
              : 'Nothing else honest fits right now. Athena can help rethink the rest of the day.'}
          </p>
          {onAskAthena ? (
            <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={onAskAthena}>
              <Sparkles aria-hidden="true" /> Ask Athena
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
