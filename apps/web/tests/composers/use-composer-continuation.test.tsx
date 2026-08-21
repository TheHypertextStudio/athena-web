import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useComposerContinuation } from '@/components/composer/use-composer-continuation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('useComposerContinuation', () => {
  it('owns the off default, duplicate guard, reset generation, announcement, and delayed focus', async () => {
    const { result, rerender } = renderHook(
      ({ creating }) =>
        useComposerContinuation({
          creating,
          successMessage: 'Project created. Ready to create another.',
        }),
      { initialProps: { creating: true } },
    );
    const title = document.createElement('input');
    const focus = vi.spyOn(title, 'focus');
    document.body.append(title);
    result.current.titleInputRef.current = title;

    expect(result.current.createMore).toBe(false);
    expect(result.current.bodyResetGeneration).toBe(0);
    expect(result.current.statusMessage).toBeNull();
    let firstClaim = false;
    let duplicateClaim = true;
    act(() => {
      firstClaim = result.current.beginSubmission();
      duplicateClaim = result.current.beginSubmission();
    });
    expect(firstClaim).toBe(true);
    expect(duplicateClaim).toBe(false);

    act(() => {
      result.current.setCreateMore(true);
      result.current.completeContinuation(() => undefined);
    });

    expect(result.current.createMore).toBe(true);
    expect(result.current.bodyResetGeneration).toBe(1);
    expect(result.current.statusMessage).toBe('Project created. Ready to create another.');
    expect(focus).not.toHaveBeenCalled();

    act(() => {
      result.current.finishSubmission();
    });
    rerender({ creating: false });

    await vi.waitFor(() => {
      expect(focus).toHaveBeenCalledOnce();
    });
    let nextClaim = false;
    act(() => {
      nextClaim = result.current.beginSubmission();
    });
    expect(nextClaim).toBe(true);
    expect(result.current.statusMessage).toBeNull();

    act(() => {
      result.current.completeContinuation(() => undefined);
    });
    expect(result.current.statusMessage).toBe('Project created. Ready to create another.');
  });
});
