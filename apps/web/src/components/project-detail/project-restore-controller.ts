'use client';

import type { ObjectCommandRequest, ObjectCommandResult } from '../../lib/contracts/object-command';
import type { DefaultError, UseMutationResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { queuedOfflineWrite } from '@/components/pwa/offline-write';
import { outboxSnapshot, subscribeOutbox } from '@/components/pwa/outbox';
import { useApiMutation } from '@/lib/query';

/** Result of the authoritative Project read that follows a restore attempt. */
export type ProjectRestoreReadResult = 'ready' | 'not-found' | 'cache-error';

/** Read state that decides which restore action the page may expose. */
export type ProjectRestoreRefreshState = 'idle' | 'pending' | 'error';

/** Application-owned reason the restore surface needs explanatory copy. */
export type ProjectRestoreFailure =
  'not-applied' | 'indeterminate-read' | 'confirmed-read' | 'queued-read' | null;

/** Account and route identity that own one Project restore flow. */
export interface ProjectRestoreScope {
  readonly accountId: string | null;
  readonly organizationId: string;
  readonly projectId: string;
}

interface RestoreOperationToken extends ProjectRestoreScope {
  readonly generation: number;
}

interface QueuedRestoreEntry {
  readonly entryId: string;
  readonly token: RestoreOperationToken;
}

/** Mutation and reconciliation state for one trashed Project receipt. */
export interface ProjectRestoreController {
  readonly restoreMutation: UseMutationResult<
    ObjectCommandResult,
    DefaultError,
    ObjectCommandRequest,
    RestoreOperationToken
  >;
  readonly refreshState: ProjectRestoreRefreshState;
  readonly failure: ProjectRestoreFailure;
  readonly retryRefresh: () => void;
  readonly reset: () => void;
}

type RestoreWriteEvidence = 'indeterminate' | 'confirmed-applied' | 'confirmed-noop' | 'queued';

function failureForRead(
  writeEvidence: RestoreWriteEvidence,
): Exclude<ProjectRestoreFailure, 'not-applied' | null> {
  if (writeEvidence === 'confirmed-applied') return 'confirmed-read';
  if (writeEvidence === 'queued') return 'queued-read';
  return 'indeterminate-read';
}

function sameScope(left: ProjectRestoreScope, right: ProjectRestoreScope): boolean {
  return (
    left.accountId === right.accountId &&
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId
  );
}

function queuedEntryIsPending(entryId: string, accountId: string | null): boolean {
  if (accountId === null) return false;
  const entry = outboxSnapshot().find((candidate) => candidate.id === entryId);
  return entry?.userId === accountId && (entry.status === 'queued' || entry.status === 'sending');
}

/** Inputs that bind one restore controller to its account, route, transports, and page callbacks. */
export interface ProjectRestoreControllerInput {
  readonly scope: ProjectRestoreScope;
  readonly executeRestore: (request: ObjectCommandRequest) => Promise<ObjectCommandResult>;
  readonly reconcile: () => Promise<ProjectRestoreReadResult>;
  readonly onReconcileStart?: (() => void) | undefined;
  readonly onRestored: () => void;
  readonly onNotApplied: () => void;
}

/**
 * Reconcile a Project restore command with one authoritative aggregate read.
 *
 * @param input - The command transport, read transport, Project identity, and page callbacks.
 * @returns Mutation controls plus the safe action state for the restore screen.
 */
export function useProjectRestoreController(
  input: ProjectRestoreControllerInput,
): ProjectRestoreController {
  const [refreshState, setRefreshState] = useState<ProjectRestoreRefreshState>('idle');
  const [failure, setFailure] = useState<ProjectRestoreFailure>(null);
  const writeEvidenceRef = useRef<RestoreWriteEvidence | null>(null);
  const queuedEntryRef = useRef<QueuedRestoreEntry | null>(null);
  const queuedEvidenceEndedRef = useRef(false);
  const generationRef = useRef(0);
  const attemptsByCommandIdRef = useRef(new Map<string, RestoreOperationToken>());
  const refreshStateRef = useRef(refreshState);
  const scopeRef = useRef<ProjectRestoreScope>(input.scope);
  const inputRef = useRef(input);
  refreshStateRef.current = refreshState;
  scopeRef.current = input.scope;
  inputRef.current = input;

  const updateRefreshState = useCallback((nextState: ProjectRestoreRefreshState): void => {
    refreshStateRef.current = nextState;
    setRefreshState(nextState);
  }, []);

  const nextToken = useCallback((): RestoreOperationToken => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    return { ...scopeRef.current, generation };
  }, []);

  const isCurrentToken = useCallback(
    (token: RestoreOperationToken | undefined): token is RestoreOperationToken =>
      token?.generation === generationRef.current && sameScope(token, scopeRef.current),
    [],
  );

  const resetReconciliation = useCallback((): void => {
    generationRef.current += 1;
    writeEvidenceRef.current = null;
    queuedEntryRef.current = null;
    queuedEvidenceEndedRef.current = false;
    attemptsByCommandIdRef.current.clear();
    updateRefreshState('idle');
    setFailure(null);
  }, [updateRefreshState]);

  const runReconciliation = useCallback(
    (writeEvidence: RestoreWriteEvidence): RestoreOperationToken => {
      const token = nextToken();
      const operation = inputRef.current;
      writeEvidenceRef.current = writeEvidence;
      if (writeEvidence === 'queued' && queuedEntryRef.current !== null) {
        queuedEntryRef.current = { ...queuedEntryRef.current, token };
      }
      updateRefreshState('pending');
      setFailure(null);
      operation.onReconcileStart?.();

      void operation
        .reconcile()
        .then((result) => {
          if (!isCurrentToken(token)) return;
          if (result === 'ready') {
            writeEvidenceRef.current = null;
            queuedEntryRef.current = null;
            updateRefreshState('idle');
            setFailure(null);
            operation.onRestored();
            return;
          }
          if (result === 'not-found' && writeEvidence === 'indeterminate') {
            writeEvidenceRef.current = null;
            queuedEntryRef.current = null;
            updateRefreshState('idle');
            setFailure(null);
            return;
          }
          if (result === 'not-found' && writeEvidence === 'confirmed-noop') {
            writeEvidenceRef.current = null;
            queuedEntryRef.current = null;
            updateRefreshState('idle');
            setFailure('not-applied');
            operation.onNotApplied();
            return;
          }
          updateRefreshState('error');
          setFailure(failureForRead(writeEvidence));
        })
        .catch(() => {
          if (!isCurrentToken(token)) return;
          updateRefreshState('error');
          setFailure(failureForRead(writeEvidence));
        });

      return token;
    },
    [isCurrentToken, nextToken, updateRefreshState],
  );

  const retryRefresh = useCallback((): void => {
    const writeEvidence = writeEvidenceRef.current;
    if (writeEvidence === null || refreshStateRef.current === 'pending') return;
    runReconciliation(writeEvidence);
  }, [runReconciliation]);

  const reconcileEndedQueuedEntry = useCallback((): void => {
    const queuedEntry = queuedEntryRef.current;
    if (queuedEntry === null) return;
    if (!isCurrentToken(queuedEntry.token)) {
      queuedEntryRef.current = null;
      return;
    }
    if (queuedEntryIsPending(queuedEntry.entryId, queuedEntry.token.accountId)) return;

    queuedEntryRef.current = null;
    if (writeEvidenceRef.current === 'queued') {
      queuedEvidenceEndedRef.current = true;
      runReconciliation('indeterminate');
    }
  }, [isCurrentToken, runReconciliation]);

  const beginQueuedReconciliation = useCallback(
    (entryId: string): void => {
      if (!queuedEntryIsPending(entryId, scopeRef.current.accountId)) {
        queuedEntryRef.current = null;
        queuedEvidenceEndedRef.current = true;
        runReconciliation('indeterminate');
        return;
      }

      const token = runReconciliation('queued');
      queuedEntryRef.current = { entryId, token };
      reconcileEndedQueuedEntry();
    },
    [reconcileEndedQueuedEntry, runReconciliation],
  );

  const restoreMutation = useApiMutation<
    ObjectCommandResult,
    ObjectCommandRequest,
    RestoreOperationToken
  >({
    mutationFn: async (request) => {
      const attempt = attemptsByCommandIdRef.current.get(request.commandId);
      try {
        return await input.executeRestore(request);
      } catch (error) {
        const queuedError = queuedOfflineWrite(error);
        if (queuedError !== null && isCurrentToken(attempt)) {
          beginQueuedReconciliation(queuedError.entryId);
        }
        throw error;
      } finally {
        attemptsByCommandIdRef.current.delete(request.commandId);
      }
    },
    onMutate: (request) => {
      const attempt = nextToken();
      writeEvidenceRef.current = null;
      queuedEntryRef.current = null;
      queuedEvidenceEndedRef.current = false;
      setFailure(null);
      attemptsByCommandIdRef.current.set(request.commandId, attempt);
      return attempt;
    },
    onError: (_error, _request, attempt) => {
      if (!isCurrentToken(attempt)) return;
      runReconciliation('indeterminate');
    },
    onSuccess: (result, _request, attempt) => {
      if (!isCurrentToken(attempt)) return;
      runReconciliation(
        result.appliedIds.includes(attempt.projectId) ? 'confirmed-applied' : 'confirmed-noop',
      );
    },
  });
  const resetMutation = restoreMutation.reset;

  useEffect(() => {
    if (!queuedEvidenceEndedRef.current) return;
    if (queuedOfflineWrite(restoreMutation.error) !== null) {
      queuedEvidenceEndedRef.current = false;
      resetMutation();
      return;
    }
    if (!restoreMutation.isPending) queuedEvidenceEndedRef.current = false;
  }, [refreshState, resetMutation, restoreMutation.error, restoreMutation.isPending]);

  const reset = useCallback((): void => {
    resetReconciliation();
    resetMutation();
  }, [resetMutation, resetReconciliation]);

  useEffect(() => {
    reset();
  }, [input.scope.accountId, input.scope.organizationId, input.scope.projectId, reset]);

  useEffect(() => {
    const unsubscribe = subscribeOutbox(reconcileEndedQueuedEntry);
    reconcileEndedQueuedEntry();
    return unsubscribe;
  }, [reconcileEndedQueuedEntry]);

  return { restoreMutation, refreshState, failure, retryRefresh, reset };
}
