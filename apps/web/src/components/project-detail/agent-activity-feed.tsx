'use client';

/** A read-only agent activity trail, deliberately without social replies. */
import type { SessionActivityType } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { Sparkles } from '@docket/ui/icons';
import type { JSX } from 'react';

import { relativeTime } from './format-time';

/** A resolved agent activity entry for a Project's recent-activity feed. */
export interface AgentActivityEntry {
  readonly id: string;
  readonly agentName: string;
  readonly type: SessionActivityType;
  readonly summary: string;
  readonly createdAt: string;
}

const ACTIVITY_VERB: Record<SessionActivityType, string> = {
  thought: 'considered',
  action: 'proposed',
  response: 'replied',
  elicitation: 'asked',
  error: 'hit an error',
};

/** Render agent progress without a social discussion or reply affordance. */
export function AgentActivityFeed({
  activities,
}: {
  activities: readonly AgentActivityEntry[];
}): JSX.Element | null {
  if (activities.length === 0) return null;
  return (
    <section aria-labelledby="agent-activity-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <h2 id="agent-activity-heading" className="text-on-surface text-body font-semibold">
          Agent activity
        </h2>
      </div>
      <ol className="flex flex-col gap-2">
        {activities.map((entry) => (
          <li
            key={entry.id}
            className="border-outline-variant bg-surface-container-low flex items-start gap-3 rounded-lg border px-3 py-2"
          >
            <ActorAvatar kind="agent" name={entry.agentName} size={24} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-on-surface text-body">
                <span className="font-medium">{entry.agentName}</span>{' '}
                <span className="text-on-surface-variant">{ACTIVITY_VERB[entry.type]}</span>
              </span>
              <span className="text-on-surface-variant truncate text-xs">{entry.summary}</span>
            </div>
            <span className="text-on-surface-variant shrink-0 text-xs">
              {relativeTime(entry.createdAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
