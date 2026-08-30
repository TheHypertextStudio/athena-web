'use client';

/** The most recent narrative update, placed beside the entity's operating brief. */
import type { UpdateOut } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import type { JSX } from 'react';

import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { relativeTime } from '@docket/ui';

/** Props for {@link LatestUpdateSummary}. */
export interface LatestUpdateSummaryProps {
  /** The newest-first updates loaded for the entity. */
  readonly updates: readonly UpdateOut[];
  /** Whether the update query is still pending. */
  readonly loading: boolean;
  /** The author formatter supplied by the owning detail screen. */
  readonly resolveActor: (actorId: string | null | undefined) => {
    readonly name: string;
    readonly kind: 'human' | 'agent' | 'team';
  };
}

/** Render the one update that belongs with an operating brief, not the full history. */
export function LatestUpdateSummary({
  updates,
  loading,
  resolveActor,
}: LatestUpdateSummaryProps): JSX.Element {
  const update = updates[0] ?? null;
  const author = update ? resolveActor(update.authorId) : null;

  return (
    <section aria-label="Latest update" className="flex flex-col gap-3">
      <h2 className="text-on-surface text-title-small">Latest update</h2>
      {loading ? (
        <div className="bg-surface-container-low h-20 animate-pulse rounded-xl" />
      ) : update === null ? (
        <p className="text-on-surface-variant text-body-medium">
          No updates yet. Use the Updates tab to keep this work current.
        </p>
      ) : (
        <div className="border-outline-variant bg-surface-container-low flex gap-3 rounded-xl border p-4">
          <ActorAvatar kind={author?.kind ?? 'human'} name={author?.name ?? 'Unknown'} size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-on-surface text-body-medium">{author?.name}</span>
              <span className="text-on-surface-variant text-label-medium">
                {relativeTime(update.createdAt)}
              </span>
              {update.health ? (
                <span className="text-on-surface-variant text-label-medium inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${HEALTH_FILL_CLASS[update.health]}`}
                  />
                  {HEALTH_LABEL[update.health]}
                </span>
              ) : null}
            </div>
            <p className="text-on-surface text-body-medium whitespace-pre-wrap">{update.body}</p>
          </div>
        </div>
      )}
    </section>
  );
}
