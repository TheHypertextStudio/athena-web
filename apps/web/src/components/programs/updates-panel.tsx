'use client';

/**
 * The Program updates panel — status posts about this program.
 *
 * @remarks
 * Renders the program's status updates newest-first, each carrying its author, a relative
 * timestamp, the health verdict it set, and its body. A composer at the top posts a new
 * update via `POST …/updates`; the newest update's health also becomes the program's current
 * health (api-rpc-contract §3.9), so the page lifts the posted update back up to refresh the
 * flow snapshot. The health picker is a styled `@docket/ui` {@link DropdownMenu} (never a
 * bare `<select>`): a calm bordered trigger showing the chosen verdict with its token dot.
 *
 * Loading uses {@link Skeleton} rows; the empty state invites the first post; a failed load
 * is announced via `role="alert"`.
 */
import type { Health, UpdateOut } from '@docket/types';
import { cn } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from './health';
import { relativeTime } from './format-time';

/** Resolve an actor id to a display name + kind (passed by the caller). */
export type ResolveActor = (actorId: string | null | undefined) => {
  name: string;
  kind: 'human' | 'agent' | 'team';
};

/** The selectable composer health values (empty string = "no change"). */
type HealthChoice = Health | '';

/** The composer's health options, in lifecycle order, plus the "no change" default. */
const HEALTH_OPTIONS: readonly { value: HealthChoice; label: string }[] = [
  { value: '', label: 'No health change' },
  { value: 'on_track', label: HEALTH_LABEL.on_track },
  { value: 'at_risk', label: HEALTH_LABEL.at_risk },
  { value: 'off_track', label: HEALTH_LABEL.off_track },
];

/** Resolve a composer health choice to its menu/trigger label. */
function choiceLabel(choice: HealthChoice): string {
  return HEALTH_OPTIONS.find((option) => option.value === choice)?.label ?? 'No health change';
}

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
  /** Post a new update with an optional health verdict. */
  onPost: (body: string, health: Health | undefined) => void;
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
}: UpdatesPanelProps): JSX.Element {
  const [body, setBody] = useState('');
  const [health, setHealth] = useState<HealthChoice>('');

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
        className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
      >
        <label htmlFor="program-update-body" className="text-on-surface text-body font-medium">
          Post an update
        </label>
        <textarea
          id="program-update-body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          rows={3}
          placeholder="Share how this line of work is flowing — wins, risks, or what changed…"
          className="border-outline-variant bg-surface-container placeholder:text-on-surface-variant focus-visible:ring-ring text-body min-h-20 w-full resize-y rounded-md border px-3 py-2 shadow-sm outline-none focus-visible:ring-1"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-on-surface-variant text-body">Set health</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  {health !== '' ? (
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[health])}
                    />
                  ) : null}
                  <span>{choiceLabel(health)}</span>
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[12rem]">
                <DropdownMenuRadioGroup
                  value={health}
                  onValueChange={(next) => {
                    setHealth(next as HealthChoice);
                  }}
                >
                  {HEALTH_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value || 'none'} value={option.value}>
                      <span className="flex items-center gap-2">
                        {option.value !== '' ? (
                          <span
                            aria-hidden="true"
                            className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[option.value])}
                          />
                        ) : null}
                        {option.label}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
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
                    {update.health ? (
                      <span className="text-on-surface-variant inline-flex items-center gap-1.5 text-xs">
                        <span
                          aria-hidden="true"
                          className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[update.health])}
                        />
                        {HEALTH_LABEL[update.health]}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-on-surface text-body leading-relaxed whitespace-pre-wrap">
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
