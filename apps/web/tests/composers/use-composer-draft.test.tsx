/**
 * The draft a create composer holds, and what applying a template does to it.
 *
 * @remarks
 * The behaviour under test is the fix for the defect this slice exists to remove: the old
 * initiative picker called `setBody(GUIDED_DOCUMENT)` on every click, which destroyed typed text
 * with no confirmation and no way back. The answer is not a confirmation prompt or an undo
 * affordance — it is that applying a template takes nothing away, so there is nothing to undo.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useComposerDraft } from '../../src/components/composer/use-composer-draft';

interface Draft {
  name: string;
  summary: string;
  description: string;
  priority: 'none' | 'high';
  health: 'on_track' | null;
}

const EMPTY: Draft = {
  name: '',
  summary: '',
  description: '',
  priority: 'none',
  health: null,
};

afterEach(cleanup);

describe('useComposerDraft', () => {
  it('sets one field at a time and leaves the rest alone', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('name', 'Checkout is broken');
    });

    expect(result.current.draft).toEqual({ ...EMPTY, name: 'Checkout is broken' });
  });

  it('derives a field from the current draft without the caller reading it', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.updateDraft((current) =>
        current.health === null ? { health: 'on_track' as const } : {},
      );
    });
    act(() => {
      result.current.updateDraft((current) => (current.health === null ? { health: null } : {}));
    });

    // The second call is a no-op because the first already filled the field — this is what stops
    // a composer's "default it once the team resolves" effect from clobbering a chosen value.
    expect(result.current.draft.health).toBe('on_track');
  });

  it('keeps the draft identity stable when a patch changes nothing', () => {
    // The task composer fills its status from an effect whose dependencies are rebuilt on every
    // render. If a no-change patch minted a fresh draft object, that effect would re-run forever —
    // which is exactly how this hook first broke the create-task composer.
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('priority', 'high');
    });
    const settled = result.current.draft;

    act(() => {
      result.current.updateDraft(() => ({}));
    });
    expect(result.current.draft).toBe(settled);

    act(() => {
      result.current.updateDraft(() => ({ priority: 'high' as const }));
    });
    expect(result.current.draft).toBe(settled);

    act(() => {
      result.current.setField('priority', 'high');
    });
    expect(result.current.draft).toBe(settled);
  });
});
