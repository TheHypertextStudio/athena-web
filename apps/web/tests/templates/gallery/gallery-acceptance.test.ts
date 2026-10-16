import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkTemplateCopyReceipt,
  type WorkTemplateGalleryAcceptRequest,
} from '@docket/work/template-gallery-contract';
import { useGalleryAcceptance } from '@/components/templates/gallery/use-gallery-acceptance';
import { UserFacingError } from '@/lib/problem';
import { galleryPreview } from './gallery-fixture';
const scope = { userId: 'viewer', orgId: 'workspace' };
const missing = async () => null;
afterEach(cleanup);
beforeEach(() => {
  window.sessionStorage.clear();
});
const request = {
  roots: ['event'],
  release: 1 as const,
  mode: 'private_drafts' as const,
  labels: [],
  offerings: [],
};
const receipt = () =>
  WorkTemplateCopyReceipt.parse({
    bundleId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    changeSetId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    mode: 'private_drafts',
    state: 'installed',
    roots: [
      { workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', workTypeVersionId: null, targetType: 'project' },
    ],
  });
describe('checked gallery acceptance', () => {
  it('retains the request ID across failure/retry and shows no simulated receipt', async () => {
    const transport = vi
      .fn<(input: WorkTemplateGalleryAcceptRequest) => Promise<ReturnType<typeof receipt>>>()
      .mockRejectedValueOnce(new Error('private provider text'))
      .mockResolvedValueOnce(receipt());
    const { result } = renderHook(() =>
      useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
    );
    await act(async () => {
      await result.current.accept(request, galleryPreview());
    });
    expect(result.current.receipt).toBeNull();
    expect(result.current.error).not.toContain('private provider text');
    await act(async () => {
      await result.current.accept(request, galleryPreview());
    });
    expect(transport.mock.calls[0]?.[0].requestId).toBe(transport.mock.calls[1]?.[0].requestId);
    expect(result.current.receipt).toEqual(receipt());
    expect(result.current.receipt?.roots[0]?.workTypeVersionId).toBeNull();
  });
  it('requires a new checked review after409 and uses a new request for changed decisions', async () => {
    const transport = vi
      .fn<(input: WorkTemplateGalleryAcceptRequest) => Promise<ReturnType<typeof receipt>>>()
      .mockRejectedValueOnce(new UserFacingError('Safe fallback', { status: 409 }))
      .mockResolvedValueOnce(receipt());
    const { result } = renderHook(() =>
      useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
    );
    await act(async () => {
      await result.current.accept(request, galleryPreview());
    });
    expect(result.current.needsReview).toBe(true);
    await act(async () => {
      await result.current.accept(request, galleryPreview());
    });
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.accept(request, {
        ...galleryPreview(),
        reviewFingerprint: `sha256:${'1'.repeat(64)}`,
      });
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0].requestId).not.toBe(transport.mock.calls[1]?.[0].requestId);
  });
});

it('preserves an undone original receipt without changing it into an installed result', async () => {
  const transport = vi.fn().mockResolvedValue({ ...receipt(), state: 'undone' });
  const { result } = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
  );
  await act(async () => {
    await result.current.accept(request, galleryPreview());
  });
  expect(result.current.receipt?.state).toBe('undone');
});

it('reconciles an unknown network outcome through the actual original-request status callback', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('Network lost after commit'));
  const lookup = vi.fn().mockResolvedValue(receipt());
  const { result } = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: lookup }),
  );
  await act(async () => {
    await result.current.accept(request, galleryPreview());
  });
  expect(result.current.receipt).toEqual(receipt());
  expect(lookup).toHaveBeenCalledExactlyOnceWith(transport.mock.calls[0]?.[0].requestId);
  expect(transport).toHaveBeenCalledTimes(1);
});

it('restores the exact request after a reload and checks its original outcome before resending', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('Unknown outcome'));
  const first = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
  );
  await act(async () => {
    await first.result.current.accept(request, galleryPreview());
  });
  const originalId = transport.mock.calls[0]?.[0].requestId;
  first.unmount();
  const lookup = vi.fn().mockResolvedValue(receipt());
  const nextTransport = vi.fn();
  const second = renderHook(() =>
    useGalleryAcceptance(nextTransport, { scope, lookupReceipt: lookup }),
  );
  await act(async () => {
    await second.result.current.accept(request, galleryPreview());
  });
  expect(lookup).toHaveBeenCalledExactlyOnceWith(originalId);
  expect(nextTransport).not.toHaveBeenCalled();
  expect(second.result.current.receipt).toEqual(receipt());
  expect(JSON.stringify(window.sessionStorage)).not.toContain('event');
});
it('separates attempts by viewer, workspace and reviewed choices', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('Unknown outcome'));
  for (const owner of [
    scope,
    { ...scope, userId: 'another-viewer' },
    { ...scope, orgId: 'another-workspace' },
  ]) {
    const hook = renderHook(() =>
      useGalleryAcceptance(transport, { scope: owner, lookupReceipt: missing }),
    );
    await act(async () => {
      await hook.result.current.accept(request, galleryPreview());
    });
    hook.unmount();
  }
  const hook = renderHook(() => useGalleryAcceptance(transport, { scope, lookupReceipt: missing }));
  await act(async () => {
    await hook.result.current.accept({ ...request, roots: ['vendor-booking'] }, galleryPreview());
  });
  expect(new Set(transport.mock.calls.map(([value]) => value.requestId)).size).toBe(4);
});

it('keeps the original identity when outcome lookup is unavailable and reset cannot establish a result', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('Unknown outcome'));
  const first = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
  );
  await act(async () => {
    await first.result.current.accept(request, galleryPreview());
  });
  const originalId = transport.mock.calls[0]?.[0].requestId;
  act(() => {
    first.result.current.reset();
  });
  first.unmount();
  const nextTransport = vi.fn();
  const lookup = vi.fn().mockRejectedValue(new Error('Unavailable'));
  const second = renderHook(() =>
    useGalleryAcceptance(nextTransport, { scope, lookupReceipt: lookup }),
  );
  await act(async () => {
    await second.result.current.accept(request, galleryPreview());
  });
  expect(lookup).toHaveBeenCalledExactlyOnceWith(originalId);
  expect(nextTransport).not.toHaveBeenCalled();
  expect(second.result.current.receipt).toBeNull();
});
it('requires explicit new installation after an undone result instead of replaying it as saved', async () => {
  const transport = vi.fn().mockResolvedValue({ ...receipt(), state: 'undone' });
  const hook = renderHook(() => useGalleryAcceptance(transport, { scope, lookupReceipt: missing }));
  await act(async () => {
    await hook.result.current.accept(request, galleryPreview());
  });
  const originalId = transport.mock.calls[0]?.[0].requestId;
  expect(hook.result.current.receipt?.state).toBe('undone');
  act(() => {
    hook.result.current.reset();
  });
  await act(async () => {
    await hook.result.current.accept(request, galleryPreview());
  });
  expect(transport.mock.calls[1]?.[0].requestId).not.toBe(originalId);
});

it('does not expose an original account receipt after the authenticated scope changes', async () => {
  const transport = vi.fn().mockResolvedValue(receipt());
  const hook = renderHook(
    ({ owner }) => useGalleryAcceptance(transport, { scope: owner, lookupReceipt: missing }),
    { initialProps: { owner: scope } },
  );
  await act(async () => {
    await hook.result.current.accept(request, galleryPreview());
  });
  expect(hook.result.current.receipt).toEqual(receipt());
  hook.rerender({ owner: { ...scope, userId: 'another-viewer' } });
  expect(hook.result.current.receipt).toBeNull();
});

it('keeps a rejected review rejected after reload until a fresh review is checked', async () => {
  const transport = vi
    .fn()
    .mockRejectedValue(new UserFacingError('Safe fallback', { status: 409 }));
  const first = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
  );
  await act(async () => {
    await first.result.current.accept(request, galleryPreview());
  });
  first.unmount();
  const retry = vi.fn();
  const second = renderHook(() => useGalleryAcceptance(retry, { scope, lookupReceipt: missing }));
  await act(async () => {
    await second.result.current.accept(request, galleryPreview());
  });
  expect(retry).not.toHaveBeenCalled();
  expect(second.result.current.needsReview).toBe(true);
});

it('does not issue an installation when this tab cannot retain its retry identity', async () => {
  const transport = vi.fn().mockResolvedValue(receipt());
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  try {
    const hook = renderHook(() =>
      useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
    );
    await act(async () => {
      await hook.result.current.accept(request, galleryPreview());
    });
    expect(transport).not.toHaveBeenCalled();
    expect(hook.result.current.receipt).toBeNull();
    expect(hook.result.current.error).toBeTruthy();
  } finally {
    storage.mockRestore();
  }
});

it('recovers the original persisted outcome on reload before any new preview or acceptance', async () => {
  const transport = vi.fn().mockRejectedValue(new Error('Response lost after commit'));
  const first = renderHook(() =>
    useGalleryAcceptance(transport, { scope, lookupReceipt: missing }),
  );
  await act(async () => {
    await first.result.current.accept(request, galleryPreview());
  });
  const originalId = transport.mock.calls[0]?.[0].requestId;
  first.unmount();
  const lookup = vi.fn().mockResolvedValue(receipt());
  const nextTransport = vi.fn();
  const next = renderHook(() =>
    useGalleryAcceptance(nextTransport, { scope, lookupReceipt: lookup }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(next.result.current.receipt).toEqual(receipt());
  expect(lookup).toHaveBeenCalledExactlyOnceWith(originalId);
  expect(nextTransport).not.toHaveBeenCalled();
});

it('does not let an in-flight original lookup expose or block another authenticated account', async () => {
  const first = renderHook(() =>
    useGalleryAcceptance(vi.fn().mockRejectedValue(new Error('Unknown outcome')), {
      scope,
      lookupReceipt: missing,
    }),
  );
  await act(async () => {
    await first.result.current.accept(request, galleryPreview());
  });
  first.unmount();
  let finishOriginal: ((result: ReturnType<typeof receipt>) => void) | undefined;
  const lookup = vi.fn(
    () =>
      new Promise<ReturnType<typeof receipt>>((resolve) => {
        finishOriginal = resolve;
      }),
  );
  const hook = renderHook(
    ({ owner }) => useGalleryAcceptance(vi.fn(), { scope: owner, lookupReceipt: lookup }),
    { initialProps: { owner: scope } },
  );
  hook.rerender({ owner: { ...scope, userId: 'different-viewer' } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.ready).toBe(true);
  await act(async () => {
    finishOriginal?.(receipt());
  });
  expect(hook.result.current.receipt).toBeNull();
  expect(hook.result.current.ready).toBe(true);
});
