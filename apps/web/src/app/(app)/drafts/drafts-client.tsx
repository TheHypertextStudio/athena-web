'use client';

/**
 * The Drafts page: everything a person set aside in a create composer, across workspaces.
 *
 * @remarks
 * One flat list grouped by what the draft would become, newest first inside each group. Choosing
 * a row reopens the composer with the draft poured in; the trailing control deletes it. The page
 * reads the same list the sidebar badge and the composer chips read, so it can never disagree
 * with them.
 */
import { EmptyState, ListCell, ListRow } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { NotePen, Trash2 } from '@docket/ui/icons';
import { Button, Skeleton, Text } from '@docket/ui/primitives';
import type { ComposerDraftKind, ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { type JSX, useCallback } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { relativeTime } from '@/components/settings/format-time';
import { ListPageLayout } from '@/components/views/page-layout';
import { deleteComposerDraft, useComposerDrafts, useDraftCacheWriters } from '@/lib/drafts/defs';

/** The order groups appear in: the altitude a person plans at, top down. */
const KIND_ORDER: readonly ComposerDraftKind[] = [
  'initiative',
  'program',
  'project',
  'task',
  'team',
];

/** Open the composer that made a draft, with the draft poured in. */
function useOpenDraft(): (draft: ComposerDraftOut) => void {
  const { openCreate } = useCreateObject();
  return useCallback(
    (draft: ComposerDraftOut): void => {
      const base = { initialWorkspaceId: draft.organizationId, draftId: draft.id };
      if (draft.kind === 'team') {
        openCreate({ kind: 'team', ...base });
        return;
      }
      openCreate({ kind: draft.kind, sameWorkspaceCompletion: 'open', ...base });
    },
    [openCreate],
  );
}

/** Props for {@link DraftGroup}. */
interface DraftGroupProps {
  readonly kind: ComposerDraftKind;
  readonly drafts: readonly ComposerDraftOut[];
  readonly workspaceName: (orgId: string) => string;
  readonly onOpen: (draft: ComposerDraftOut) => void;
  readonly onDelete: (draft: ComposerDraftOut) => void;
}

/** One kind's drafts under a vocabulary-skinned heading. */
function DraftGroup({
  kind,
  drafts,
  workspaceName,
  onOpen,
  onDelete,
}: DraftGroupProps): JSX.Element {
  const noun = useVocabulary(kind);
  const plural = useVocabulary(kind, { plural: true });
  return (
    <section aria-label={plural} className="flex flex-col gap-1">
      <Text as="h2" token="label-large" tone="muted" className="px-3">
        {plural}
      </Text>
      <div role="grid" aria-label={plural} className="flex flex-col">
        {drafts.map((draft) => {
          const label = draft.title ?? `Untitled ${noun.toLowerCase()}`;
          return (
            <ListRow
              key={draft.id}
              onActivate={() => {
                onOpen(draft);
              }}
            >
              <ListCell className="min-w-0 flex-1 gap-2">
                <NotePen aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </ListCell>
              <ListCell className="shrink-0">
                <Text as="span" token="label-small" tone="muted">
                  {workspaceName(draft.organizationId)}
                </Text>
              </ListCell>
              <ListCell className="shrink-0">
                <Text as="span" token="label-small" tone="muted">
                  {relativeTime(draft.updatedAt)}
                </Text>
              </ListCell>
              <ListCell className="shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  iconOnly
                  controlSize="sm"
                  aria-label={`Delete draft ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(draft);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </ListCell>
            </ListRow>
          );
        })}
      </div>
    </section>
  );
}

/** The page body once the list has loaded. */
function DraftGroups({ items }: { readonly items: readonly ComposerDraftOut[] }): JSX.Element {
  const { orgs } = useActiveOrg();
  const cache = useDraftCacheWriters();
  const onOpen = useOpenDraft();
  const workspaceName = useCallback(
    (orgId: string): string => orgs.find((org) => org.id === orgId)?.name ?? 'Workspace',
    [orgs],
  );
  const onDelete = useCallback(
    (draft: ComposerDraftOut): void => {
      cache.remove(draft.id);
      void deleteComposerDraft(draft.id);
    },
    [cache],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={NotePen}
        title="No drafts"
        body="Anything you start in a composer and save as a draft shows up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {KIND_ORDER.map((kind) => {
        const drafts = items.filter((item) => item.kind === kind);
        if (drafts.length === 0) return null;
        return (
          <DraftGroup
            key={kind}
            kind={kind}
            drafts={drafts}
            workspaceName={workspaceName}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}

/** The Drafts page. */
export default function DraftsClient(): JSX.Element {
  const drafts = useComposerDrafts();

  return (
    <ListPageLayout title="Drafts" subtitle="What you set aside before it became a record.">
      {drafts.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : null}
      {drafts.isError ? (
        <EmptyState
          icon={NotePen}
          title="Your drafts did not load"
          body="Check your connection and try again."
          cta={{ label: 'Try again', onClick: () => void drafts.refetch() }}
        />
      ) : null}
      {drafts.data ? <DraftGroups items={drafts.data.items} /> : null}
    </ListPageLayout>
  );
}
