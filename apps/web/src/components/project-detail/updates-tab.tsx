'use client';

/**
 * The Updates tab — status posts about this project.
 *
 * @remarks
 * Renders the project's status updates newest-first, each carrying its author, relative
 * timestamp, the health verdict it set, and its body. A composer at the top posts a new
 * update via `POST …/updates`; the newest update's health also becomes the project's current
 * health (api-rpc-contract §3.9), so the page lifts the posted update back up to refresh the
 * overview. Loading uses {@link Skeleton} rows; the empty state invites the first post; a
 * failed load is announced via `role="alert"`.
 */
import type { Health, UpdateOut } from '@docket/types';
import { cn } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import type { ActorDirectory } from './actor-directory';
import { relativeTime } from './format-time';
import { HEALTH_DOT_CLASS, HEALTH_LABEL } from './health';

/** The selectable health verdicts in the composer (plus a "no change" option). */
const HEALTH_OPTIONS: readonly { value: Health | ''; label: string }[] = [
  { value: '', label: 'No health change' },
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

/** Props for {@link UpdatesTab}. */
export interface UpdatesTabProps {
  /** The project's updates, newest-first. */
  updates: readonly UpdateOut[];
  /** Whether the updates are still loading. */
  loading: boolean;
  /** A load error to announce, if any. */
  error: string | null;
  /** Resolve an author id to its display name + kind. */
  resolveActor: ActorDirectory;
  /** Whether a post is in flight. */
  posting: boolean;
  /** A post error to surface, if any. */
  postError: string | null;
  /** Post a new update with an optional health verdict. */
  onPost: (body: string, health: Health | undefined) => void;
}

/**
 * The Updates tab body.
 *
 * @param props - The {@link UpdatesTabProps}.
 * @returns the rendered tab.
 */
export function UpdatesTab({
  updates,
  loading,
  error,
  resolveActor,
  posting,
  postError,
  onPost,
}: UpdatesTabProps): JSX.Element {
  const [body, setBody] = useState('');
  const [health, setHealth] = useState<Health | ''>('');

  function submit(event: React.SyntheticEvent): void {
    event.preventDefault();
    if (body.trim().length === 0) return;
    onPost(body.trim(), health === '' ? undefined : health);
    setBody('');
    setHealth('');
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={submit}
        className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4"
      >
        <label htmlFor="update-body" className="text-foreground text-sm font-medium">
          Post an update
        </label>
        <textarea
          id="update-body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          rows={3}
          placeholder="Share progress, risks, or what changed…"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-20 w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            Set health
            <select
              aria-label="Update health"
              value={health}
              onChange={(event) => {
                setHealth(event.target.value as Health | '');
              }}
              className="border-input bg-background focus-visible:ring-ring text-foreground rounded-md border px-2 py-1 text-sm shadow-sm outline-none focus-visible:ring-1"
            >
              {HEALTH_OPTIONS.map((opt) => (
                <option key={opt.value || 'none'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
            {posting ? 'Posting…' : 'Post update'}
          </Button>
        </div>
        {postError ? (
          <p role="alert" className="text-destructive text-sm">
            {postError}
          </p>
        ) : null}
      </form>

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
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      ) : updates.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          No updates yet. Post the first one to keep stakeholders in the loop.
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {updates.map((update) => {
            const author = resolveActor(update.authorId);
            return (
              <li key={update.id} className="flex gap-3">
                <ActorAvatar kind={author.kind} name={author.name} size={32} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">{author.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {relativeTime(update.createdAt)}
                    </span>
                    {update.health ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                        <span
                          aria-hidden="true"
                          className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[update.health])}
                        />
                        {HEALTH_LABEL[update.health]}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-foreground/90 text-sm leading-relaxed whitespace-pre-wrap">
                    {update.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
