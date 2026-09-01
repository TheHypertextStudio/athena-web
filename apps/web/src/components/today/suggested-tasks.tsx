'use client';

import type { HubTodaySuggestion } from '../../lib/contracts/hub';
import { ArrowRight, Play, Plus, Sparkles, X } from '@docket/ui/icons';
import { Button, ControlGroup } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, useMemo, useState } from 'react';

import { OrgChip } from '@/components/org-chip';

import { TodaySection } from './today-section';

/** Props for {@link SuggestedTasks}. */
export interface SuggestedTasksProps {
  readonly suggestions: readonly HubTodaySuggestion[];
  readonly orgName: (organizationId: string) => string;
  readonly onAdd: (suggestion: HubTodaySuggestion) => void;
  readonly onStart: (suggestion: HubTodaySuggestion) => void;
  readonly onAskAthena?: () => void;
  readonly busy?: boolean;
  readonly blockedPlan?: boolean;
}

/** Tasks the server established can fit the time remaining today. */
export default function SuggestedTasks({
  suggestions,
  orgName,
  onAdd,
  onStart,
  onAskAthena,
  busy = false,
  blockedPlan = false,
}: SuggestedTasksProps): JSX.Element {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = useMemo(
    () => suggestions.filter((item) => !dismissed.has(item.id)).slice(0, 3),
    [suggestions, dismissed],
  );
  return (
    <TodaySection
      id="suggested-tasks-heading"
      heading="Suggested tasks"
      count={visible.length > 0 ? visible.length : undefined}
    >
      {/* The one supporting line on this page. These rows are suggestions rather than commitments,
          and which of two situations produced them changes what they mean. */}
      <p className="text-on-surface-variant text-body-small">
        {blockedPlan
          ? 'The rest of the plan is blocked. These tasks fit the time left.'
          : 'The plan is complete. These tasks fit the time left.'}
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
                <ControlGroup controlSize="lg" wrap>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onStart(suggestion);
                    }}
                  >
                    <Play aria-hidden="true" /> Start now
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      onAdd(suggestion);
                    }}
                  >
                    <Plus aria-hidden="true" /> Add to today
                  </Button>
                  <Button asChild variant="ghost" iconOnly aria-label="Open task">
                    <Link href={`/orgs/${suggestion.organizationId}/tasks/${suggestion.id}`}>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label="Dismiss"
                    onClick={() => {
                      setDismissed((current) => new Set([...current, suggestion.id]));
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </ControlGroup>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bg-surface-container-low mt-1 rounded-xl p-4">
          <p className="text-on-surface text-body-medium">
            {blockedPlan ? 'No task fits around the blocker.' : 'No tasks left.'}
          </p>
          <p className="text-on-surface-variant text-body-small mt-1">
            {blockedPlan
              ? 'Open the blocked task to resolve its dependency, or ask Athena to rebuild the plan.'
              : 'No remaining task fits the time left. Athena can rebuild the rest of the day.'}
          </p>
          {onAskAthena ? (
            <Button type="button" variant="outline" className="mt-3" onClick={onAskAthena}>
              <Sparkles aria-hidden="true" /> Ask Athena
            </Button>
          ) : null}
        </div>
      )}
    </TodaySection>
  );
}
