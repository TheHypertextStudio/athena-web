'use client';

/** Searchable hierarchy editor shared by Initiative context menus and detail controls. */
import type {
  InitiativeHierarchyCandidate,
  InitiativeOverviewItem,
  InitiativeOverviewOut,
} from '@docket/types';
import { PickerList, type PickerOption } from '@docket/ui/components';
import { Target } from '@docket/ui/icons';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  type PopoverVirtualAnchor,
  Button,
  Skeleton,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  invalidateInitiativeHierarchyRoute,
  initiativeDragObjectFromRef,
  resolveInitiativeHierarchyMutation,
  writeInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import {
  type CoordinatedInitiativeHierarchyMutation,
  type InitiativeHierarchyWriteToken,
  useInitiativeHierarchyWriteCoordinator,
  useInitiativeHierarchyWriteRevision,
} from '@/components/initiatives/initiative-hierarchy-write-coordinator';
import { selfOrDescendantPredicate } from '@/components/initiatives/hierarchy-dnd';
import {
  capturePickerAnchor,
  type InitiativeHierarchyPickerRequest,
} from '@/components/pickers/picker-overlay';
import { api } from '@/lib/api';
import { initiativeHierarchyCandidatesDef } from '@/lib/fetch-initiative-hierarchy-candidates';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, useApiQuery } from '@/lib/query';

/** Props for {@link InitiativeHierarchyPickerOverlay}. */
export interface InitiativeHierarchyPickerOverlayProps {
  readonly request: InitiativeHierarchyPickerRequest;
  readonly onClose: () => void;
  /** Stable identity used to retain this overlay's shared child lock across renders. */
  readonly operationOwnerId?: string;
  /** Report whether this overlay owns a write or required refresh that prevents replacement. */
  readonly onBusyChange?: (busy: boolean) => void;
}

interface PendingHierarchyReconciliation {
  readonly token: InitiativeHierarchyWriteToken;
  readonly mutation: CoordinatedInitiativeHierarchyMutation;
  readonly childOrganizationId: string;
  readonly writeError: string | null;
}

/** Convert one overview item to the minimal drag vocabulary used by hierarchy planning. */
function dragObjectFromItem(
  item: Pick<
    InitiativeOverviewItem | InitiativeHierarchyCandidate,
    'id' | 'parentInitiativeId' | 'parentLinkId'
  >,
) {
  return {
    id: item.id,
    parentInitiativeId: item.parentInitiativeId,
    parentLinkId: item.parentLinkId,
  };
}

/** Return whether refreshed route data proves that one requested mutation reached its end state. */
function refreshedHierarchyMatchesMutation(
  items: readonly Pick<InitiativeOverviewItem, 'id' | 'parentInitiativeId' | 'parentLinkId'>[],
  mutation: CoordinatedInitiativeHierarchyMutation,
  childOrganizationId: string,
  contextOrganizationId: string,
): boolean {
  const child = items.find((item) => item.id === mutation.childInitiativeId);
  if (mutation.kind === 'detach') {
    if (child !== undefined) {
      return child.parentInitiativeId === null && child.parentLinkId === null;
    }
    return childOrganizationId !== contextOrganizationId;
  }
  return child?.parentInitiativeId === mutation.parentInitiativeId && child.parentLinkId !== null;
}

/** The popover that chooses a new parent or an existing Initiative to adopt as a child. */
export function InitiativeHierarchyPickerOverlay({
  request,
  onClose,
  operationOwnerId,
  onBusyChange,
}: InitiativeHierarchyPickerOverlayProps): JSX.Element {
  const { organizationId: orgId, mode, subject } = request;
  const generatedOwnerId = useId();
  const ownerId = operationOwnerId ?? generatedOwnerId;
  const queryClient = useQueryClient();
  const coordinator = useInitiativeHierarchyWriteCoordinator();
  const coordinatorRevision = useInitiativeHierarchyWriteRevision(coordinator);
  const overview = useApiQuery(initiativeOverviewDef(orgId, api));
  const items = useMemo(() => overview.data?.items ?? [], [overview.data]);
  const candidatesQuery = useApiQuery(initiativeHierarchyCandidatesDef(orgId, mode, api));
  const candidates = useMemo(() => candidatesQuery.data?.items ?? [], [candidatesQuery.data]);
  const [writeError, setWriteError] = useState<string | null>(null);
  const pendingReconciliationRef = useRef<PendingHierarchyReconciliation | null>(null);
  const locallyBusyRef = useRef(false);
  const mountedRef = useRef(true);

  const operation = coordinator.operationForOwner(ownerId);
  const fixedSubjectOperation =
    mode === 'parent' ? coordinator.operationForChild(orgId, subject.id) : null;
  const fixedSubjectBusyElsewhere =
    fixedSubjectOperation !== null && fixedSubjectOperation.ownerId !== ownerId;
  const controlsDisabled = operation !== null || fixedSubjectBusyElsewhere;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isSelfOrDescendant = useMemo(
    () =>
      selfOrDescendantPredicate(new Map(items.map((item) => [item.id, item.parentInitiativeId]))),
    [items],
  );
  const currentSubject = useMemo(
    () => items.find((item) => item.id === subject.id),
    [items, subject.id],
  );
  const subjectDragObject = useMemo(() => {
    if (currentSubject !== undefined) return dragObjectFromItem(currentSubject);
    return initiativeDragObjectFromRef(subject);
  }, [currentSubject, subject]);

  const options = useMemo<readonly PickerOption[]>(() => {
    return candidates
      .filter((item) => {
        if (item.id === subject.id) return false;
        // Choosing a parent cannot choose the subject's descendant. Choosing a child cannot choose
        // an ancestor of the subject, because either relationship would create a cycle.
        return mode === 'parent'
          ? !isSelfOrDescendant(subject.id, item.id)
          : !isSelfOrDescendant(item.id, subject.id);
      })
      .map((item) => {
        const childId = mode === 'parent' ? subject.id : item.id;
        const activeOperation = coordinator.operationForChild(orgId, childId);
        return {
          value: item.id,
          label: item.name,
          icon: <Target aria-hidden className="size-5" />,
          supporting: item.crossWorkspace
            ? [item.organizationName, item.summary].filter(Boolean).join(' · ')
            : (item.summary ?? undefined),
          keywords: [item.organizationName, item.summary ?? ''],
          disabled: activeOperation !== null && activeOperation.ownerId !== ownerId,
        };
      });
  }, [
    candidates,
    coordinator,
    coordinatorRevision,
    isSelfOrDescendant,
    mode,
    orgId,
    ownerId,
    subject.id,
  ]);

  const reconcile = useCallback(
    async (pending: PendingHierarchyReconciliation): Promise<void> => {
      coordinator.transition(pending.token, 'refreshing');
      try {
        await invalidateInitiativeHierarchyRoute(queryClient, orgId);
        await queryClient.fetchQuery(initiativeOverviewDef(orgId, api));
      } catch {
        if (!mountedRef.current) {
          pendingReconciliationRef.current = null;
          locallyBusyRef.current = false;
          coordinator.release(pending.token);
          onBusyChange?.(false);
          return;
        }
        coordinator.transition(pending.token, 'refresh_failed');
        return;
      }

      const refreshed = queryClient.getQueryData<InitiativeOverviewOut>(
        queryKeys.initiatives(orgId),
      );
      const applied =
        refreshed !== undefined &&
        refreshedHierarchyMatchesMutation(
          refreshed.items,
          pending.mutation,
          pending.childOrganizationId,
          orgId,
        );

      pendingReconciliationRef.current = null;
      locallyBusyRef.current = false;
      coordinator.release(pending.token);
      onBusyChange?.(false);
      if (!mountedRef.current) return;
      if (applied) {
        onClose();
        return;
      }
      setWriteError(pending.writeError ?? 'Could not change this initiative hierarchy.');
    },
    [coordinator, onBusyChange, onClose, orgId, queryClient],
  );

  const applyTarget = useCallback(
    async (targetId: string | null): Promise<void> => {
      if (locallyBusyRef.current) return;
      const selected = targetId === null ? null : candidates.find((item) => item.id === targetId);
      if (targetId !== null && selected === undefined) return;
      const dragged =
        mode === 'parent' ? subjectDragObject : selected ? dragObjectFromItem(selected) : null;
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

      const token = coordinator.claim({
        organizationId: orgId,
        childInitiativeId: mutation.childInitiativeId,
        ownerId,
        mutation,
      });
      if (token === null) return;
      locallyBusyRef.current = true;
      onBusyChange?.(true);
      setWriteError(null);
      let writeErrorMessage: string | null = null;
      try {
        await writeInitiativeHierarchyMutation(orgId, mutation);
      } catch (error) {
        writeErrorMessage = userErrorMessage(error, 'Could not change this initiative hierarchy.');
      }

      const pending = {
        token,
        mutation,
        childOrganizationId:
          (mode === 'parent' ? subject.organizationId : selected?.organizationId) ?? orgId,
        writeError: writeErrorMessage,
      } satisfies PendingHierarchyReconciliation;
      pendingReconciliationRef.current = pending;
      await reconcile(pending);
    },
    [
      candidates,
      coordinator,
      isSelfOrDescendant,
      mode,
      onClose,
      onBusyChange,
      orgId,
      ownerId,
      reconcile,
      subject.organizationId,
      subject.id,
      subjectDragObject,
    ],
  );

  const retryRefresh = useCallback((): void => {
    const pending = pendingReconciliationRef.current;
    if (pending === null) return;
    void reconcile(pending);
  }, [reconcile]);

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
        if (!open && !locallyBusyRef.current && !fixedSubjectBusyElsewhere) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (capturedAnchor.focusTarget?.isConnected) capturedAnchor.focusTarget.focus();
        }}
      >
        {operation?.phase === 'refresh_failed' ? (
          <div className="m-1 flex flex-col items-start gap-2">
            <div
              role="alert"
              className="text-error bg-error/5 border-error/30 text-body-medium w-full rounded-md border px-3 py-2"
            >
              Could not refresh the initiative hierarchy.
            </div>
            <Button type="button" variant="outline" onClick={retryRefresh}>
              Retry refresh
            </Button>
          </div>
        ) : writeError ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {writeError}
          </div>
        ) : null}
        {(overview.isError && overview.data === undefined) ||
        (candidatesQuery.isError && candidatesQuery.data === undefined) ? (
          <div
            role="alert"
            className="text-error bg-error/5 border-error/30 text-body-medium m-1 rounded-md border px-3 py-2"
          >
            {userErrorMessage(
              overview.data === undefined && overview.error
                ? overview.error
                : candidatesQuery.error,
              'Could not load initiatives.',
            )}
          </div>
        ) : overview.isPending || candidatesQuery.isPending ? (
          <div className="flex flex-col gap-1.5 p-1.5" aria-hidden="true">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          <>
            {operation?.phase === 'writing' || operation?.phase === 'refreshing' ? (
              <div
                role="status"
                className="text-on-surface-variant text-body-medium bg-surface-container m-1 rounded-md px-3 py-2"
              >
                {operation.phase === 'writing' ? 'Updating hierarchy…' : 'Refreshing hierarchy…'}
              </div>
            ) : null}
            <fieldset
              disabled={controlsDisabled}
              aria-busy={operation !== null || undefined}
              className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
            >
              <PickerList
                options={options}
                selected={mode === 'parent' ? subjectDragObject.parentInitiativeId : null}
                onSelect={(value) => {
                  void applyTarget(value);
                }}
                searchPlaceholder={mode === 'parent' ? 'Choose a parent…' : 'Choose an initiative…'}
                emptyText="No valid initiatives"
                ariaLabel={mode === 'parent' ? 'Parent initiative' : 'Sub-initiative'}
                clear={
                  mode === 'parent' && subjectDragObject.parentLinkId !== null
                    ? {
                        label: 'Top level',
                        onClear: () => {
                          void applyTarget(null);
                        },
                      }
                    : null
                }
              />
            </fieldset>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
