'use client';

/**
 * The Drafts page: everything a person set aside in a create composer, across workspaces.
 *
 * @remarks
 * One flat list, newest first, each row marked with the glyph of what the draft would become.
 * Choosing a row reopens the composer with the draft poured in; the trailing control deletes it. The page
 * reads the same list the sidebar badge and the composer chips read, so it can never disagree
 * with them.
 */
import { EmptyState, ListCell, ListRow } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, Layers, NotePen, TaskAlt, Target, Trash2, Users } from '@docket/ui/icons';
import { Button, Skeleton, Text } from '@docket/ui/primitives';
import type { ComposerDraftKind, ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { type ComponentType, type JSX, useCallback } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { relativeTime } from '@/components/settings/format-time';
import { ListPageLayout } from '@/components/views/page-layout';
import { deleteComposerDraft, useComposerDrafts, useDraftCacheWriters } from '@/lib/drafts/defs';

/** The glyph each kind of draft carries, matching the icon its record has everywhere else. */
const KIND_ICON: Record<ComposerDraftKind, ComponentType<{ className?: string }>> = {
  task: TaskAlt,
  project: FolderKanban,
  initiative: Target,
  program: Layers,
  team: Users,
};

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

/** Props for {@link DraftItem}. */
interface DraftItemProps {
  readonly draft: ComposerDraftOut;
  readonly workspaceName: string;
  readonly onOpen: (draft: ComposerDraftOut) => void;
  readonly onDelete: (draft: ComposerDraftOut) => void;
}

/** One draft: its kind's glyph, title, workspace, age, and a trailing delete. */
function DraftItem({ draft, workspaceName, onOpen, onDelete }: DraftItemProps): JSX.Element {
  const noun = useVocabulary(draft.kind);
  const Icon = KIND_ICON[draft.kind];
  const label = draft.title ?? `Untitled ${noun.toLowerCase()}`;
  return (
    <ListRow
      onActivate={() => {
        onOpen(draft);
      }}
    >
      <ListCell className="min-w-0 flex-1 gap-3">
        <Icon aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </ListCell>
      {/* Fixed columns, so the workspace and time of every row line up. */}
      <ListCell className="hidden w-36 shrink-0 @2xl:flex">
        <Text as="span" token="label-small" tone="muted" truncate>
          {workspaceName}
        </Text>
      </ListCell>
      <ListCell className="w-20 shrink-0 justify-end">
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
}

/** The page body once the list has loaded: one list, newest first. */
function DraftList({ items }: { readonly items: readonly ComposerDraftOut[] }): JSX.Element {
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

  if (items.length === 0) return <EmptyState icon={NotePen} title="No drafts" />;

  const newestFirst = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    // Pulled 12px into the page gutter: a row keeps 12px of its own padding, so its text and the
    // page title start on one line while the row's hover surface reaches past them.
    <div role="grid" aria-label="Drafts" className="-mx-3 flex flex-col">
      {newestFirst.map((draft) => (
        <DraftItem
          key={draft.id}
          draft={draft}
          workspaceName={workspaceName(draft.organizationId)}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

/** The Drafts page. */
export default function DraftsClient(): JSX.Element {
  const drafts = useComposerDrafts();

  return (
    <ListPageLayout title="Drafts">
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
      {drafts.data ? <DraftList items={drafts.data.items} /> : null}
    </ListPageLayout>
  );
}
