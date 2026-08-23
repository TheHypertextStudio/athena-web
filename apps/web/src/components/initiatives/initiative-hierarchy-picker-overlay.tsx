'use client';

/** Searchable hierarchy editor shared by Initiative context menus and detail controls. */
import type { InitiativeOverviewItem } from '@docket/types';
import { PickerList, type PickerOption } from '@docket/ui/components';
import { Target } from '@docket/ui/icons';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  type PopoverVirtualAnchor,
  Skeleton,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useMemo, useRef, useState } from 'react';

import {
  initiativeDragObjectFromRef,
  resolveInitiativeHierarchyMutation,
  writeInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import { selfOrDescendantPredicate } from '@/components/initiatives/hierarchy-dnd';
import {
  capturePickerAnchor,
  type InitiativeHierarchyPickerRequest,
} from '@/components/pickers/picker-overlay';
import { api } from '@/lib/api';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, useApiQuery } from '@/lib/query';

/** Props for {@link InitiativeHierarchyPickerOverlay}. */
export interface InitiativeHierarchyPickerOverlayProps {
  readonly request: InitiativeHierarchyPickerRequest;
  readonly onClose: () => void;
}

/** Convert one overview item to the minimal drag vocabulary used by hierarchy planning. */
function dragObjectFromItem(item: InitiativeOverviewItem) {
  return {
    id: item.id,
    parentInitiativeId: item.parentInitiativeId,
    parentLinkId: item.parentLinkId,
  };
}

/** The popover that chooses a new parent or an existing Initiative to adopt as a child. */
export function InitiativeHierarchyPickerOverlay({
  request,
  onClose,
}: InitiativeHierarchyPickerOverlayProps): JSX.Element {
  const { organizationId: orgId, mode, subject } = request;
  const queryClient = useQueryClient();
  const overview = useApiQuery(initiativeOverviewDef(orgId, api));
  const items = useMemo(() => overview.data?.items ?? [], [overview.data]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const isSelfOrDescendant = useMemo(
    () =>
      selfOrDescendantPredicate(new Map(items.map((item) => [item.id, item.parentInitiativeId]))),
    [items],
  );

  const options = useMemo<readonly PickerOption[]>(() => {
    return items
      .filter((item) => item.organizationId === orgId)
      .filter((item) => {
        if (item.id === subject.id) return false;
        // Choosing a parent cannot choose the subject's descendant. Choosing a child cannot choose
        // an ancestor of the subject, because either relationship would create a cycle.
        return mode === 'parent'
          ? !isSelfOrDescendant(subject.id, item.id)
          : !isSelfOrDescendant(item.id, subject.id);
      })
      .map((item) => ({
        value: item.id,
        label: item.name,
        icon: <Target aria-hidden className="size-5" />,
        supporting: item.summary ?? undefined,
      }));
  }, [isSelfOrDescendant, items, mode, orgId, subject.id]);

  const applyTarget = useCallback(
    async (targetId: string | null): Promise<void> => {
      if (writing) return;
      const selected = targetId === null ? null : items.find((item) => item.id === targetId);
      if (targetId !== null && selected === undefined) return;
      const dragged =
        mode === 'parent'
          ? initiativeDragObjectFromRef(subject)
          : selected
            ? dragObjectFromItem(selected)
            : null;
      if (dragged === null) return;
      const resolvedTargetId = mode === 'parent' ? targetId : subject.id;
      const mutation = resolveInitiativeHierarchyMutation({
        dragged,
        targetId: resolvedTargetId,
        isSelfOrDescendant,
      });
      if (mutation.kind === 'noop') {
        onClose();
        return;
      }

      setWriting(true);
      setWriteError(null);
      try {
        await writeInitiativeHierarchyMutation(orgId, mutation);
        await queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
        onClose();
      } catch (error) {
        setWriteError(userErrorMessage(error, 'Could not change this initiative hierarchy.'));
        setWriting(false);
      }
    },
    [isSelfOrDescendant, items, mode, onClose, orgId, queryClient, subject, writing],
  );

  const capturedAnchor = useRef(
    capturePickerAnchor(
      request.anchor ??
        (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null),
    ),
  ).current;
  const anchorRef = useRef<PopoverVirtualAnchor | null>(capturedAnchor.virtual);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (capturedAnchor.focusTarget?.isConnected) capturedAnchor.focusTarget.focus();
        }}
      >
        {writeError ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {writeError}
          </div>
        ) : overview.isError ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {userErrorMessage(overview.error, 'Could not load initiatives.')}
          </div>
        ) : overview.isPending ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          <PickerList
            options={options}
            selected={
              mode === 'parent' ? initiativeDragObjectFromRef(subject).parentInitiativeId : null
            }
            onSelect={(value) => {
              void applyTarget(value);
            }}
            searchPlaceholder={mode === 'parent' ? 'Choose a parent…' : 'Choose an initiative…'}
            emptyText="No valid initiatives"
            ariaLabel={mode === 'parent' ? 'Parent initiative' : 'Sub-initiative'}
            clear={
              mode === 'parent' && initiativeDragObjectFromRef(subject).parentLinkId !== null
                ? {
                    label: 'Top level',
                    onClear: () => {
                      void applyTarget(null);
                    },
                  }
                : null
            }
          />
        )}
        {writing ? (
          <span className="sr-only" role="status">
            Updating hierarchy
          </span>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
