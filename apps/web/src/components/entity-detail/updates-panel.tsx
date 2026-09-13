'use client';

/**
 * The shared entity updates panel — status posts about a program, initiative, or project.
 *
 * @remarks
 * Renders the entity's status updates newest-first, each carrying its author, a relative
 * timestamp, the health verdict it set, and its body. A composer at the top posts a new
 * update via `POST …/updates`; where the health composer is shown, the newest update's health
 * also becomes the entity's current health (api-rpc-contract §3.9), so the page lifts the
 * posted update back up to refresh the flow snapshot. The health picker is a styled
 * `@docket/ui` {@link DropdownMenu} (never a bare `<select>`): a calm bordered trigger showing
 * the chosen verdict with its token dot. Surfaces where health is not update-driven (e.g.
 * Project) pass `showHealthComposer={false}` to hide it.
 *
 * Loading uses {@link Skeleton} rows; the empty state invites the first post; a failed load
 * is announced via `role="alert"`.
 */
import type { Health } from '@docket/work/capability-contract';
import type { UpdateOut } from '@docket/work/update-contract';
import { cn, relativeTime } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { StaticMarkdown } from '@/components/editor/static-markdown';

import { UpdatesComposer } from './updates-composer';

/** Resolve an actor id to a display name + kind (passed by the caller). */
export type ResolveActor = (actorId: string | null | undefined) => {
  name: string;
  kind: 'human' | 'agent' | 'team';
};

/** Props for {@link UpdatesPanel}. */
export interface UpdatesPanelProps {
  /** The program's updates, newest-first. */
  updates: readonly UpdateOut[];
  /** Whether the updates are still loading. */
  loading: boolean;
  /** A load error to announce, if any. */
  error: string | null;
  /** Resolve an author id to its display name + kind. */
  resolveActor: ResolveActor;
  /** Whether a post is in flight. */
  posting: boolean;
  /** A post error to surface, if any. */
  postError: string | null;
  /**
   * Post a new update with an optional health verdict.
   *
   * @remarks
   * Returns a promise that settles with the write, so the panel can clear the composer on success
   * and preserve the draft on failure. A rejection is expected to be reported through
   * {@link UpdatesPanelProps.postError}; the panel swallows it rather than re-reporting.
   */
  onPost: (body: string, health: Health | undefined) => Promise<void>;
  /**
   * Show the "Set health" composer control. Defaults to `true`; pass `false` on surfaces where
   * health is not update-driven (e.g. Project) so the composer posts a plain update.
   */
  showHealthComposer?: boolean;
}

/**
 * The Program updates panel body.
 *
 * @param props - The {@link UpdatesPanelProps}.
 * @returns the rendered panel.
 */
export function UpdatesPanel({
  updates,
  loading,
  error,
  resolveActor,
  posting,
  postError,
  onPost,
  showHealthComposer = true,
}: UpdatesPanelProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <UpdatesComposer
        posting={posting}
        postError={postError}
        onPost={onPost}
        showHealthComposer={showHealthComposer}
      />

      {/* placeholder: the posted updates — how many there are, who wrote each one, when, and what
          it says. The composer above stays usable throughout, so someone can post before the
          history has arrived. */}
      {loading ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p
          role="alert"
          className="border-outline-variant text-error text-body-medium rounded-xl border p-4"
        >
          {error}
        </p>
      ) : updates.length === 0 ? (
        <div className="border-outline-variant text-on-surface-variant text-body-medium rounded-xl border border-dashed p-8 text-center">
          No updates yet. Post the first one to keep stakeholders in the loop.
        </div>
      ) : (
        <ol className="flex flex-col gap-6">
          {updates.map((update) => {
            const author = resolveActor(update.authorId);
            return (
              <li key={update.id} className="flex gap-3">
                <ActorAvatar kind={author.kind} name={author.name} size={32} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-on-surface text-label-large">{author.name}</span>
                    <span className="text-on-surface-variant text-body-small">
                      {relativeTime(update.createdAt)}
                    </span>
                    {update.health ? (
                      <span className="text-on-surface-variant text-body-small inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[update.health])}
                        />
                        {HEALTH_LABEL[update.health]}
                      </span>
                    ) : null}
                  </div>
                  <StaticMarkdown value={update.body} className="max-w-none" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
