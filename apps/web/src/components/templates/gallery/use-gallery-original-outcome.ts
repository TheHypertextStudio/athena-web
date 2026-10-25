'use client';
import { useEffect, useRef, useState } from 'react';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { userErrorMessage } from '@/lib/problem';
import {
  clearGalleryOriginal,
  readGalleryOriginal,
  galleryScopeOwner,
} from './gallery-acceptance-attempt';
import type { GalleryAcceptanceOptions } from './use-gallery-acceptance';

/** A real original outcome is reconciled before source reads or a replacement installation can proceed. */
export interface GalleryOriginalOutcome {
  readonly ready: boolean;
  readonly checking: boolean;
  readonly receipt: WorkTemplateCopyReceipt | null;
  readonly error: string | null;
  readonly resume: () => Promise<WorkTemplateCopyReceipt | null>;
  readonly clear: () => void;
}
interface OriginalState {
  readonly owner: string;
  readonly ready: boolean;
  readonly checking: boolean;
  readonly receipt: WorkTemplateCopyReceipt | null;
  readonly error: string | null;
}
/** Reconcile a tab's opaque original request on reload, without treating the pointer as execution authority. */
export function useGalleryOriginalOutcome(
  options: GalleryAcceptanceOptions,
): GalleryOriginalOutcome {
  const owner = galleryScopeOwner(options.scope);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [state, setState] = useState<OriginalState>({
    owner,
    ready: false,
    checking: false,
    receipt: null,
    error: null,
  });
  const running = useRef<{
    owner: string;
    promise: Promise<WorkTemplateCopyReceipt | null>;
  } | null>(null);
  function commit(next: OriginalState): void {
    if (currentOwner.current === owner) setState(next);
  }
  async function resume(): Promise<WorkTemplateCopyReceipt | null> {
    if (running.current?.owner === owner) return running.current.promise;
    const previous = readGalleryOriginal(options.scope);
    if (!previous) {
      commit({ owner, ready: true, checking: false, receipt: null, error: null });
      return null;
    }
    commit({ owner, ready: false, checking: true, receipt: null, error: null });
    const check = async (): Promise<WorkTemplateCopyReceipt | null> => {
      try {
        const result = await options.lookupReceipt(previous.requestId);
        const receipt = result === null ? null : WorkTemplateCopyReceipt.parse(result);
        if (!receipt) clearGalleryOriginal(options.scope);
        commit({ owner, ready: true, checking: false, receipt, error: null });
        return receipt;
      } catch (failure) {
        commit({
          owner,
          ready: false,
          checking: false,
          receipt: null,
          error: userErrorMessage(
            failure,
            'Could not check the original copy request. Check again before creating another copy.',
          ),
        });
        throw failure;
      }
    };
    const promise = check();
    const registered = { owner, promise };
    running.current = registered;
    try {
      return await promise;
    } finally {
      if (running.current === registered) running.current = null;
    }
  }
  useEffect(() => {
    void resume().catch(() => undefined);
  }, [owner]);
  function clear(): void {
    if (state.owner !== owner || !state.ready) return;
    clearGalleryOriginal(options.scope, true);
    commit({ owner, ready: true, checking: false, receipt: null, error: null });
  }
  const current = state.owner === owner;
  return {
    ready: current && state.ready,
    checking: current && state.checking,
    receipt: current ? state.receipt : null,
    error: current ? state.error : null,
    resume,
    clear,
  };
}
