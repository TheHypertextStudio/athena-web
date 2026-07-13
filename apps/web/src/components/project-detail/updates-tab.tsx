'use client';

/**
 * The Updates tab — status posts about this project.
 *
 * @remarks
 * Renders the project's updates newest-first, each carrying its author, relative timestamp, and
 * body. A quiet freeform composer posts through `POST …/updates`; no health verdict is presented.
 */
import type { UpdateOut } from '@docket/types';
import { ActorAvatar } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import { FreeformText, FreeformTextEditor } from '@/components/editor/freeform-text';

import type { ActorDirectory } from './actor-directory';
import { relativeTime } from './format-time';

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
  /** Post a new update. */
  onPost: (body: string) => void;
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

  function post(): void {
    if (body.trim().length === 0) return;
    onPost(body.trim());
    setBody('');
  }

  function submit(event: React.SyntheticEvent): void {
    event.preventDefault();
    post();
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={submit}
        className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
      >
        <label htmlFor="update-body" className="text-on-surface text-body font-medium">
          Post an update
        </label>
        <FreeformTextEditor
          value={body}
          onChange={setBody}
          placeholder="Share progress, risks, or what changed…"
          ariaLabel="Update body"
          disabled={posting}
          onSubmit={post}
          className="border-outline-variant bg-surface-container min-h-20 rounded-md border px-3 py-2 shadow-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-on-surface-variant text-xs">⌘↵ to post</span>
          <Button type="submit" size="sm" disabled={posting || body.trim().length === 0}>
            {posting ? 'Posting…' : 'Post update'}
          </Button>
        </div>
        {postError ? (
          <p role="alert" className="text-destructive text-body">
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
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-lg border p-4"
        >
          {error}
        </p>
      ) : updates.length === 0 ? (
        <div className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
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
                    <span className="text-on-surface text-body font-medium">{author.name}</span>
                    <span className="text-on-surface-variant text-xs">
                      {relativeTime(update.createdAt)}
                    </span>
                  </div>
                  <FreeformText
                    value={update.body}
                    emptyText=""
                    className="text-on-surface text-body leading-relaxed"
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
