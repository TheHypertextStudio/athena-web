'use client';
import { useRef, useState } from 'react';
import { WorkTemplateCopyUndoResult } from '@docket/work/template-gallery-contract';
import { userErrorMessage } from '@/lib/problem';
import { useTemplateGalleryCopyUndo } from '../work-template-gallery-queries';
import type { GalleryBundleUndoState } from './gallery-bundle-undo';

/** Reverse one real bundle, keeping the current canonical view on failure and suppressing duplicate clicks. */
export function useGalleryBundleUndo(orgId: string, bundleId: string): GalleryBundleUndoState {
  const mutation = useTemplateGalleryCopyUndo(orgId);
  const active = useRef(false);
  const [state, setState] = useState<{
    bundleId: string;
    outcome: WorkTemplateCopyUndoResult | null;
    error: string | null;
  }>({ bundleId, outcome: null, error: null });
  async function undo(): Promise<void> {
    if (active.current) return;
    active.current = true;
    setState({ bundleId, outcome: null, error: null });
    try {
      const outcome = WorkTemplateCopyUndoResult.parse(await mutation.mutateAsync({ bundleId }));
      if (outcome.receipt.bundleId !== bundleId)
        throw new Error('Unexpected copy reversal identity.');
      setState({ bundleId, outcome, error: null });
    } catch (failure) {
      setState({
        bundleId,
        outcome: null,
        error: userErrorMessage(
          failure,
          'This copy could not be undone. Your saved definitions are still here.',
        ),
      });
    } finally {
      active.current = false;
    }
  }
  const current = state.bundleId === bundleId;
  return {
    pending: mutation.isPending,
    error: current ? state.error : null,
    outcome: current ? state.outcome : null,
    onUndo: () => {
      void undo();
    },
  };
}
