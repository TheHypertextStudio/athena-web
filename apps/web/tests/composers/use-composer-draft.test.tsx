/**
 * The draft a create composer holds, and what applying a template does to it.
 *
 * @remarks
 * The behaviour under test is the fix for the defect this slice exists to remove: the old
 * initiative picker called `setBody(GUIDED_DOCUMENT)` on every click, which destroyed typed text
 * with no confirmation and no way back. The two properties that matter are that an apply *merges*
 * rather than replaces, and that a single undo restores exactly what was on screen beforehand.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useComposerDraft } from '../../src/components/composer/use-composer-draft';

interface Draft {
  name: string;
  description: string;
  priority: 'none' | 'high';
  ownerId: string | null;
}

const EMPTY: Draft = { name: '', description: '', priority: 'none', ownerId: null };

const BUG = { id: 'tpl_bug', name: 'Bug report' };
const SPIKE = { id: 'tpl_spike', name: 'Research spike' };

afterEach(cleanup);

describe('useComposerDraft', () => {
  it('sets one field at a time and leaves the rest alone', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('name', 'Checkout is broken');
    });

    expect(result.current.draft).toEqual({ ...EMPTY, name: 'Checkout is broken' });
  });

  it('merges a template instead of replacing the draft, so typed text survives', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('name', 'Checkout is broken');
      result.current.setField('ownerId', 'actor_1');
    });
    act(() => {
      result.current.applyTemplate({ description: '## Steps', priority: 'high' }, BUG);
    });

    expect(result.current.draft).toEqual({
      name: 'Checkout is broken',
      description: '## Steps',
      priority: 'high',
      ownerId: 'actor_1',
    });
    expect(result.current.appliedTemplate).toEqual(BUG);
  });

  it('restores the exact pre-apply draft on undo', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('name', 'Checkout is broken');
      result.current.setField('description', 'notes I typed myself');
    });
    const before = result.current.draft;

    act(() => {
      result.current.applyTemplate({ description: '## Steps', priority: 'high' }, BUG);
    });
    expect(result.current.draft.description).toBe('## Steps');

    act(() => {
      result.current.undoTemplate();
    });

    expect(result.current.draft).toEqual(before);
    expect(result.current.appliedTemplate).toBeNull();
  });

  it('undoes only the most recent apply, not back past the first one', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.applyTemplate({ description: '## Steps', priority: 'high' }, BUG);
    });
    const afterFirst = result.current.draft;

    act(() => {
      result.current.applyTemplate({ description: '## Question' }, SPIKE);
    });
    expect(result.current.appliedTemplate).toEqual(SPIKE);

    act(() => {
      result.current.undoTemplate();
    });

    // Back to the bug-report draft, not to the empty one. A control labelled "Undo" returns what
    // was on screen when it was pressed; walking further back would be a history nobody can see.
    expect(result.current.draft).toEqual(afterFirst);
  });

  it('is inert when undo is pressed with nothing applied', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.setField('name', 'Untouched');
    });
    act(() => {
      result.current.undoTemplate();
    });

    expect(result.current.draft).toEqual({ ...EMPTY, name: 'Untouched' });
  });

  it('derives a field from the current draft without the caller reading it', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.updateDraft((current) =>
        current.ownerId === null ? { ownerId: 'actor_default' } : {},
      );
    });
    act(() => {
      result.current.updateDraft((current) =>
        current.ownerId === null ? { ownerId: 'actor_second' } : {},
      );
    });

    // The second call is a no-op because the first already filled the field — this is what stops
    // a composer's "default it once the team resolves" effect from clobbering a chosen value.
    expect(result.current.draft.ownerId).toBe('actor_default');
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
      result.current.updateDraft(() => ({ priority: 'high' }));
    });
    expect(result.current.draft).toBe(settled);

    act(() => {
      result.current.setField('priority', 'high');
    });
    expect(result.current.draft).toBe(settled);
  });

  it('does not arm the undo for a derived default', () => {
    const { result } = renderHook(() => useComposerDraft<Draft>(EMPTY));

    act(() => {
      result.current.updateDraft(() => ({ priority: 'high' }));
    });

    expect(result.current.appliedTemplate).toBeNull();
  });
});
