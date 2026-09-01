'use client';

/**
 * `publishing` — the publish control that sits beside a detail header's overflow menu.
 *
 * @remarks
 * The author asked for "an icon that is a sibling to the overflow menu", and the word *sibling*
 * is doing real work. Publishing is not a rarely-used administrative action to be buried three
 * clicks deep in a "…" menu; it is a first-class thing you do to a record, and it belongs at the
 * same level of the interface as the record's other top-level actions. So this renders as a
 * peer `<Button iconOnly>` in the same control row — never a `DropdownMenuItem`.
 *
 * Because it is a sibling, its geometry must match its siblings exactly. It takes no size of its
 * own: the enclosing `ControlGroup` (supplied by the detail header) sets the step, and `iconOnly`
 * makes the button square at that step. That is how the identical height, icon size, and hit
 * area a sibling control requires are guaranteed rather than eyeballed — there is no number here to
 * drift.
 *
 * The state it can be in is genuinely three-valued, and the icon says which: never published,
 * published, withdrawn. The dialog behind it is where the address, the live URLs, and the
 * withdraw action live, because a header has no room to explain any of that and a person about
 * to publish work to the open internet deserves to see exactly what will be reachable.
 */
import { env } from '@docket/env/web';
import type { PublicationSubjectKind } from '@docket/work/publish-contract';
import { suggestPublicSlug } from '@docket/work/publish-contract';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { Globe } from '@docket/ui/icons';
import { useEffect, useRef, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import {
  usePublicationState,
  usePublishMutation,
  useWithdrawMutation,
  useMoveBriefMutation,
} from './use-publishing';

/** Props for {@link PublishAction}. */
export interface PublishActionProps {
  /** The workspace the record belongs to. */
  readonly orgId: string;
  /** Which kind of record is being published. */
  readonly subjectKind: PublicationSubjectKind;
  /** The record id. */
  readonly subjectId: string;
  /** The record's title, used to propose an address. */
  readonly title: string;
  /** The workspace's word for this kind of record, e.g. "Initiative". */
  readonly noun: string;
  /** Whether the caller may publish (the `contribute` capability). */
  readonly canPublish: boolean;
}

/** The mutually exclusive publication state a newly opened dialog may render. */
export type PublicationDialogState = 'loading' | 'error' | 'published' | 'unpublished';

/**
 * Keep a deferred publication lookup from being mistaken for an unpublished document.
 *
 * @param publication - The resolved publication row, if one exists.
 * @param loading - Whether the dialog's publication lookup is still in flight.
 * @returns The single action state the dialog may render.
 */
export function publicationDialogState(
  publication: ReturnType<typeof usePublicationState>['publication'],
  status: ReturnType<typeof usePublicationState>['status'],
): PublicationDialogState {
  if (status === 'loading' || status === 'idle') return 'loading';
  if (status === 'error') return 'error';
  return publication?.published === true ? 'published' : 'unpublished';
}

/**
 * Keep cached publication data behind the loading state until this dialog opening initializes its
 * address field.
 *
 * @param lookupState - The publication read's state.
 * @param dialogGeneration - The current dialog opening identifier.
 * @param initializedGeneration - The opening whose address state has been initialized.
 * @returns The state the dialog may expose to a person.
 */
export function resolvedPublicationDialogState(
  lookupState: PublicationDialogState,
  dialogGeneration: number,
  initializedGeneration: number | null,
): PublicationDialogState {
  if (lookupState === 'error') return 'error';
  if (lookupState === 'loading' || initializedGeneration !== dialogGeneration) return 'loading';
  return lookupState;
}

/**
 * The publish icon button and its dialog.
 *
 * @param props - The {@link PublishActionProps}.
 * @returns The control, or `null` when the caller cannot publish.
 */
export function PublishAction({
  orgId,
  subjectKind,
  subjectId,
  title,
  noun,
  canPublish,
}: PublishActionProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [dialogGeneration, setDialogGeneration] = useState(0);
  const initializedGeneration = useRef<number | null>(null);
  const [initializedDialogGeneration, setInitializedDialogGeneration] = useState<number | null>(
    null,
  );
  const {
    publication,
    status: publicationStatus,
    retry: retryPublicationState,
  } = usePublicationState(orgId, subjectKind, subjectId, open);
  // Gated on `open` — nobody needs the workspace's address until they open this dialog.
  const orgQ = useApiQuery(
    apiQueryOptions(
      queryKeys.organization(orgId),
      () => api.v1.orgs[':orgId'].$get({ param: { orgId } }),
      'Could not load the workspace.',
      { enabled: open },
    ),
  );
  const publish = usePublishMutation(orgId);
  const withdraw = useWithdrawMutation(orgId);
  const move = useMoveBriefMutation(orgId);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    if (
      !open ||
      publicationStatus !== 'ready' ||
      initializedGeneration.current === dialogGeneration
    )
      return;
    setSlug(publication?.slug ?? suggestPublicSlug(title));
    initializedGeneration.current = dialogGeneration;
    setInitializedDialogGeneration(dialogGeneration);
  }, [dialogGeneration, open, publication?.slug, publicationStatus, title]);

  if (!canPublish) return null;

  // One narrowed binding rather than a boolean plus a nullable object: every branch below needs
  // both facts together, and splitting them is how a "published but no row" impossible state
  // gets written by accident.
  const lookupState = publicationDialogState(publication, publicationStatus);
  const dialogState = resolvedPublicationDialogState(
    lookupState,
    dialogGeneration,
    initializedDialogGeneration,
  );
  const live = dialogState === 'published' ? publication : null;
  const published = dialogState === 'published';
  const lower = noun.toLowerCase();
  const label = published ? `Published to the web — manage` : `Publish this ${lower} to the web`;
  const pending = publish.isPending || withdraw.isPending || move.isPending;
  const error = publish.error ?? withdraw.error ?? move.error;
  // The full prefix a record's own slug sits under: the shared brief host plus the workspace's
  // own identity slug. `undefined` only when this deployment has no shared brief host configured
  // at all — never a fabricated domain.
  const briefHost = env.NEXT_PUBLIC_BRIEF_HOST;
  const workspaceSlug = orgQ.data?.slug;
  const prefix =
    briefHost !== undefined && workspaceSlug !== undefined
      ? `${briefHost}/${workspaceSlug}/`
      : undefined;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            iconOnly
            aria-label={label}
            data-published={published ? 'true' : 'false'}
            // Colour, never geometry: a published record's icon takes the accent, and the button
            // stays exactly the size of its siblings in both states.
            className={published ? 'text-primary' : undefined}
            onClick={() => {
              publish.reset();
              withdraw.reset();
              move.reset();
              setDialogGeneration((generation) => generation + 1);
              setOpen(true);
            }}
          >
            <Globe />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState === 'loading'
                ? 'Loading publishing status'
                : dialogState === 'error'
                  ? 'Could not load publishing status'
                  : published
                    ? 'Published to the web'
                    : `Publish this ${lower}`}
            </DialogTitle>
            <DialogDescription>
              {dialogState === 'loading'
                ? 'Checking whether this page is already published.'
                : dialogState === 'error'
                  ? 'Try again before changing this page’s publication.'
                  : published
                    ? 'Anyone with the link can read this page. It always shows the current record — there is no separate copy.'
                    : `Anyone with the link will be able to read this ${lower} as a public page — Docket calls it a brief. It stays in step with the record automatically, so there's no separate copy to keep up to date.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field
              label="Address"
              description="Lowercase letters, numbers, and hyphens. This is the last part of the link."
              {...(error ? { error: userErrorMessage(error, 'Could not save this address.') } : {})}
            >
              <Input
                controlSize="lg"
                value={slug}
                spellCheck={false}
                autoComplete="off"
                disabled={dialogState === 'loading' || dialogState === 'error'}
                {...(prefix === undefined ? {} : { prefix })}
                onChange={(event) => {
                  setSlug(event.target.value);
                }}
              />
            </Field>

            {dialogState === 'loading' || dialogState === 'error' ? null : live ? (
              live.urls.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <Text as="p" token="label-medium" tone="muted">
                    Reachable at
                  </Text>
                  {live.urls.map((url) => (
                    <Text as="p" token="body-small" key={url}>
                      <a
                        className="underline underline-offset-2"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {url}
                      </a>
                    </Text>
                  ))}
                </div>
              ) : (
                <Text as="p" token="body-small" tone="muted">
                  {/* Honest rather than reassuring: every workspace has its own address now, so the
                      only way this page is published but unreachable is a deployment with no
                      shared brief host configured and no verified custom domain. Saying "published"
                      without saying that would be the exact "shows success when nothing happened"
                      failure this product refuses. */}
                  This page is published but not reachable yet — verify a custom domain in Settings
                  → Publishing.
                </Text>
              )
            ) : null}
          </div>

          <DialogFooter>
            {dialogState === 'loading' ? (
              <Text as="p" token="body-small" tone="muted">
                Loading…
              </Text>
            ) : dialogState === 'error' ? (
              <Button type="button" onClick={retryPublicationState}>
                Try again
              </Button>
            ) : live ? (
              <>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    withdraw.mutate(live.id, {
                      onSuccess: () => {
                        setOpen(false);
                      },
                    });
                  }}
                >
                  Unpublish
                </Button>
                <Button
                  disabled={pending || slug === live.slug}
                  onClick={() => {
                    move.mutate(
                      { publicationId: live.id, slug },
                      {
                        onSuccess: () => {
                          setOpen(false);
                        },
                      },
                    );
                  }}
                >
                  Save address
                </Button>
              </>
            ) : (
              <Button
                disabled={pending || slug.length === 0}
                onClick={() => {
                  publish.mutate(
                    { subjectKind, subjectId, slug },
                    {
                      onSuccess: () => {
                        setOpen(false);
                      },
                    },
                  );
                }}
              >
                Publish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
