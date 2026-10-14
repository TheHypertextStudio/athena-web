'use client';

import { Button, DialogBody, DialogFooter, Skeleton } from '@docket/ui/primitives';
import { RefreshCw } from '@docket/ui/icons';
import { type JSX } from 'react';
import { QueryLoadFailure } from '@/components/feedback';
import {
  SeriesManagementAttention,
  SeriesManagementHeader,
  SeriesManagementHistory,
  SeriesManagementRevisions,
  SeriesManagementSchedule,
  SeriesManagementUpcoming,
} from './series-management-regions';
import {
  useSeriesManagement,
  type SeriesManagementOptions,
  type SeriesManagementState,
} from './use-series-management';

/** Shared route and overlay workspace, including its guarded dismissal mode. */
export interface SeriesManagementContentProps extends SeriesManagementOptions {
  readonly overlay?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly confirmingDiscard?: boolean | undefined;
  readonly onKeepEditing?: (() => void) | undefined;
  readonly onDiscard?: (() => void) | undefined;
}

/** Manage one series without navigating away from the generated task or project. */
export function SeriesManagementContent({
  overlay = false,
  onClose,
  confirmingDiscard = false,
  onKeepEditing,
  onDiscard,
  ...options
}: SeriesManagementContentProps): JSX.Element {
  const state = useSeriesManagement(options);
  const locked = confirmingDiscard || state.busy;
  const ready = state.detail !== null;
  return (
    <div
      className={
        overlay
          ? 'flex min-h-0 flex-1 flex-col'
          : '@container mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col'
      }
    >
      {ready ? (
        <SeriesManagementHeader state={state} overlay={overlay} onClose={onClose} locked={locked} />
      ) : null}
      <DialogBody inset="responsive" className="flex flex-col gap-6" inert={locked}>
        {state.detailQ.isPending ? (
          <SeriesLoading />
        ) : !ready ? (
          <QueryLoadFailure title="This repeating work" query={state.detailQ} />
        ) : (
          <>
            <SeriesManagementAttention state={state} />
            <div className="grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_20rem]">
              <SeriesManagementSchedule state={state} locked={locked} />
              <SeriesManagementUpcoming state={state} />
            </div>
            <SeriesManagementHistory state={state} />
            <SeriesManagementRevisions state={state} />
          </>
        )}
      </DialogBody>
      <SeriesManagementFooter
        state={state}
        ready={ready}
        confirmingDiscard={confirmingDiscard}
        onClose={onClose}
        onKeepEditing={onKeepEditing}
        onDiscard={onDiscard}
      />
    </div>
  );
}

function SeriesLoading(): JSX.Element {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </>
  );
}

function SeriesManagementFooter({
  state,
  ready,
  confirmingDiscard,
  onClose,
  onKeepEditing,
  onDiscard,
}: {
  readonly state: SeriesManagementState;
  readonly ready: boolean;
  readonly confirmingDiscard: boolean;
  readonly onClose: (() => void) | undefined;
  readonly onKeepEditing: (() => void) | undefined;
  readonly onDiscard: (() => void) | undefined;
}): JSX.Element {
  const locked = confirmingDiscard || state.busy;
  return (
    <DialogFooter inset="responsive">
      {!ready && onClose ? (
        <Button variant="ghost" onClick={onClose}>
          Close repeating work
        </Button>
      ) : null}
      {confirmingDiscard ? (
        <>
          <p
            role="status"
            className="text-body-small text-on-surface-variant sm:mr-auto sm:self-center"
          >
            Discard your unsaved schedule changes?
          </p>
          <Button variant="ghost" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="secondary" onClick={onDiscard}>
            Discard changes
          </Button>
        </>
      ) : ready && state.draft ? (
        <Button
          onClick={state.saveSchedule}
          disabled={state.draft.kind === 'none' || locked || state.detail?.status === 'ended'}
        >
          <RefreshCw className="size-4" />{' '}
          {state.edit.isPending ? 'Saving schedule…' : 'Save future schedule'}
        </Button>
      ) : null}
    </DialogFooter>
  );
}
