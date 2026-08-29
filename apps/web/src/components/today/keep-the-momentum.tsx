'use client';

import type { HubTodaySuggestion } from '@docket/types';
import { ArrowRight, Play, Plus, Sparkles, X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useMemo, useState } from 'react';

import { OrgChip } from '@/components/org-chip';

import { TodaySection } from './today-section';

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
    <TodaySection
      id="momentum-heading"
      heading="Keep the momentum"
      count={visible.length > 0 ? visible.length : undefined}
    >
      {/* The one line of narration kept anywhere on this page, because it is the only section whose
          contents need a *reason* to be trusted: these are suggestions, and which of two situations
          produced them changes what they mean. */}
      <p className="text-on-surface-variant text-body-small">
        {blockedPlan
          ? 'Your remaining plan is blocked. This is work that fits while you wait.'
          : 'Your plan is clear. This is work that fits the time left.'}
      </p>
      {visible.length > 0 ? (
        <ul className="bg-surface-container-low divide-outline-variant mt-1 divide-y rounded-xl px-4">
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
        <div className="bg-surface-container-low mt-1 rounded-xl p-4">
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
    </TodaySection>
  );
}
