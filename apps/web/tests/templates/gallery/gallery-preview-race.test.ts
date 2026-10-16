import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type {
  WorkTemplateGalleryPreview,
  WorkTemplateGalleryPreviewRequest,
} from '@docket/work/template-gallery-contract';
import { useGalleryReview } from '@/components/templates/gallery/use-gallery-review';
import { galleryPreview } from './gallery-fixture';
const transport = vi.hoisted(() => vi.fn());
vi.mock('@/components/templates/work-template-gallery-queries', () => ({
  useTemplateGalleryPreview: () => ({ mutateAsync: transport }),
}));
beforeEach(() => {
  transport.mockReset();
});
const choices: WorkTemplateGalleryPreviewRequest = {
  roots: ['event'],
  release: 1,
  mode: 'private_drafts',
  labels: [],
  offerings: [],
};
it('discards an older response after a visibility decision changes and checks the exact latest request', async () => {
  let finishOld: ((preview: WorkTemplateGalleryPreview) => void) | undefined;
  transport
    .mockImplementationOnce(
      () =>
        new Promise<WorkTemplateGalleryPreview>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...galleryPreview(), mode: 'published' });
  const hook = renderHook(({ request }) => useGalleryReview('workspace', request), {
    initialProps: { request: choices },
  });
  hook.rerender({ request: { ...choices, mode: 'published' } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.checked?.preview.mode).toBe('published');
  expect(transport.mock.calls[1]?.[0]).toEqual({ ...choices, mode: 'published' });
  await act(async () => {
    finishOld?.(galleryPreview());
  });
  expect(hook.result.current.checked?.request.mode).toBe('published');
  expect(hook.result.current.updating).toBe(false);
});
it('preserves the current decisions when checking fails and exposes only application-owned error copy', async () => {
  transport.mockRejectedValue(new Error('provider secret'));
  const hook = renderHook(() => useGalleryReview('workspace', choices));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.checked).toBeNull();
  expect(hook.result.current.error).toContain('selection could not be prepared');
  expect(hook.result.current.error).not.toContain('provider secret');
  expect(choices.roots).toEqual(['event']);
});

it('does not read source previews while an original copy outcome is being reconciled', async () => {
  const hook = renderHook(() => useGalleryReview('workspace', choices, false));
  await act(async () => {
    await Promise.resolve();
  });
  expect(transport).not.toHaveBeenCalled();
  expect(hook.result.current.checked).toBeNull();
  expect(hook.result.current.updating).toBe(false);
});
