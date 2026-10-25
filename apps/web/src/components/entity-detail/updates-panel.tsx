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
 * renders a {@link QueryLoadFailure} panel in place of the history.
 */
import type { DeliverableOut } from '@docket/work/attachment-contract';
import { DeliverableList, DeliverablePicker } from './deliverables';
import type { Health } from '@docket/work/capability-contract';
import type { UpdateOut } from '@docket/work/update-contract';
import { cn, relativeTime } from '@docket/ui';
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
  Surface,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useRef, useState } from 'react';

import { useActiveOrgIdOptional } from '@/components/active-org';
import { HEALTH_FILL_CLASS, HEALTH_LABEL } from '@/components/entity-display/health';
import { FreeformTextEditor } from '@/components/editor/freeform-text';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { QueryLoadFailure, type QueryFailureSource } from '@/components/feedback';
import { contentAuthor } from './content-author';
import { clearContentPostRequestKey, contentPostRequestKey } from '@/lib/content-post-retry';

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
  /** Workspace owning this post; defaults to the active workspace. */
  orgId?: string | undefined;
  /** Stable identity for retry keys; includes the update's organization and subject. */
  submissionScope: string;
  /** The program's updates, newest-first. */
  updates: readonly UpdateOut[];
  /** Whether the updates are still loading. */
  loading: boolean;
  /** The updates query, passed only while its read is failing; it replaces the history. */
  loadFailure?: QueryFailureSource | null | undefined;
  /** Resolve an author id to its display name + kind. */
  resolveActor: ResolveActor;
  /** Whether a post is in flight. */
  posting: boolean;
  /**
   * Post a new update with an optional health verdict.
   *
   * @remarks
   * Returns a promise that settles with the write, so the panel can clear the composer on success
   * and preserve the draft on failure. The write's own mutation presents a rejection as a notice;
   * the panel swallows it rather than re-reporting.
   */
  onPost: (
    body: string,
    health: Health | undefined,
    attachmentIds?: string[],
    requestId?: string,
  ) => Promise<void>;
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
  orgId,
  submissionScope,
  updates,
  loading,
  loadFailure = null,
  resolveActor,
  posting,
  onPost,
  showHealthComposer = true,
}: UpdatesPanelProps): JSX.Element {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<DeliverableOut[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const bodyRef = useRef('');
  const [composerKey, setComposerKey] = useState(0);
  const contextOrgId = useActiveOrgIdOptional();
  const activeOrgId = orgId ?? contextOrgId;
  const [health, setHealth] = useState<HealthChoice>('');

  /**
   * Post the draft, clearing the composer only once the update is actually saved.
   *
   * @remarks
   * Clearing on submit would discard the text the author needs to retry a failed post. Awaiting the
   * parent's write keeps a failed draft exactly where it was.
   */
  async function submit(): Promise<void> {
    const trimmed = bodyRef.current.trim();
    if (trimmed.length === 0 || posting || filesBusy) return;
    try {
      const payload = {
        body: trimmed,
        health: health === '' ? undefined : health,
        attachmentIds: files.map((file) => file.id),
      };
      const requestId = await contentPostRequestKey(submissionScope, payload);
      await onPost(payload.body, payload.health, payload.attachmentIds, requestId);
      await clearContentPostRequestKey(submissionScope, payload, requestId);
    } catch {
      // The parent's mutation presents the failure as a notice; keep the draft to retry.
      return;
    }
    bodyRef.current = '';
    setBody('');
    setFiles([]);
    setComposerKey((current) => current + 1);
    setHealth('');
  }

  const healthAction = showHealthComposer ? (
    <UpdateHealthPicker health={health} onChange={setHealth} />
  ) : null;
  const submitAction = (
    <Button type="submit" size="sm" disabled={posting || filesBusy || body.trim().length === 0}>
      {posting ? 'Posting…' : 'Post update'}
    </Button>
  );
  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Surface tone="card" pad="roomy" className="flex flex-col gap-3">
          <p className="text-on-surface text-label-large">Post an update</p>
          <FreeformTextEditor
            key={composerKey}
            value={body}
            onChange={(next) => {
              bodyRef.current = next;
              setBody(next);
            }}
            {...(activeOrgId === null ? {} : { mentionOrgId: activeOrgId })}
            ariaLabel="Post an update"
            placeholder="Share how this line of work is flowing — wins, risks, or what changed…"
            className="bg-surface-container-high hover:bg-surface-container-highest min-h-20 rounded-lg p-3 transition-colors"
            disabled={posting}
            onSubmit={() => {
              void submit();
            }}
          />
          {activeOrgId ? (
            <DeliverablePicker
              orgId={activeOrgId}
              files={files}
              onChange={setFiles}
              onBusy={setFilesBusy}
              disabled={posting}
              secondaryActions={healthAction}
              primaryAction={submitAction}
            />
          ) : (
            <div className="flex items-center justify-between gap-2">
              {healthAction}
              {submitAction}
            </div>
          )}
        </Surface>
      </form>

      {/* placeholder: the posted updates — how many there are, who wrote each one, when, and what
          it says. The composer above stays usable throughout, so someone can post before the
          history has arrived. */}
      <UpdateHistory
        updates={updates}
        loading={loading}
        loadFailure={loadFailure}
        resolveActor={resolveActor}
      />
    </div>
  );
}

function UpdateHealthPicker({
  health,
  onChange,
}: {
  readonly health: HealthChoice;
  readonly onChange: (health: HealthChoice) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            aria-label={`Set health: ${choiceLabel(health)}`}
          >
            {health !== '' ? (
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[health])}
              />
            ) : null}
            <span>{health === '' ? 'Health' : choiceLabel(health)}</span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="sm">
          <DropdownMenuRadioGroup
            value={health}
            onValueChange={(next) => {
              onChange(next as HealthChoice);
            }}
          >
            {HEALTH_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value || 'none'} value={option.value}>
                <span className="flex items-center gap-2">
                  {option.value !== '' ? (
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 rounded-full', HEALTH_FILL_CLASS[option.value])}
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
  );
}

function UpdateHistory({
  updates,
  loading,
  loadFailure,
  resolveActor,
}: Pick<UpdatesPanelProps, 'updates' | 'loading' | 'loadFailure' | 'resolveActor'>): JSX.Element {
  return (
    <>
      {' '}
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
      ) : loadFailure ? (
        <QueryLoadFailure title="Updates" query={loadFailure} size="panel" />
      ) : updates.length === 0 ? (
        <div className="text-on-surface-variant text-body-medium rounded-xl p-8 text-center">
          No updates yet. Post the first one to keep stakeholders in the loop.
        </div>
      ) : (
        <ol className="flex flex-col gap-6">
          {updates.map((update) => {
            const author = contentAuthor(update, resolveActor);
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
                  <DeliverableList files={update.attachments} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
