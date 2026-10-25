import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { WorkTemplateSourceCopyPreviewRequest } from '@docket/work/template-copy';
import { useTemplateCopyAcceptance } from '@/components/templates/gallery/use-gallery-acceptance';
import { sourceCopyAttempt } from '@/components/templates/source-copy/source-copy-attempt';

const scope = {
  userId: 'person',
  sessionId: 'actual-session',
  orgId: 'destination',
  attemptId: 'flow-one',
};
const request = WorkTemplateSourceCopyPreviewRequest.parse({
  roots: [
    {
      kind: 'draft',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    },
  ],
  mode: 'private_drafts',
});
const preview = { mode: 'private_drafts' as const, reviewFingerprint: `sha256:${'a'.repeat(64)}` };
const receipt = WorkTemplateCopyReceipt.parse({
  bundleId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  changeSetId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  mode: 'private_drafts',
  state: 'installed',
  roots: [
    { workTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAY', workTypeVersionId: null, targetType: 'project' },
  ],
});
beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(cleanup);
it('uses the canonical acceptance lifecycle for exact saved-source choices and lost-response recovery', async () => {
  const lookup = vi.fn().mockResolvedValue(receipt);
  const accept = vi.fn().mockRejectedValue(new Error('Private transport detail'));
  const hook = renderHook(() =>
    useTemplateCopyAcceptance(accept, { scope, lookupReceipt: lookup }, sourceCopyAttempt),
  );
  await act(async () => {
    await hook.result.current.accept(request, preview);
  });
  expect(accept).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      ...request,
      expectedReviewFingerprint: preview.reviewFingerprint,
      requestId: expect.any(String),
    }),
  );
  expect(hook.result.current.receipt).toEqual(receipt);
  hook.unmount();
  const next = vi.fn();
  const restored = renderHook(() =>
    useTemplateCopyAcceptance(
      next,
      { scope, lookupReceipt: vi.fn().mockResolvedValue(receipt) },
      sourceCopyAttempt,
    ),
  );
  await act(async () => {
    await restored.result.current.resume();
  });
  expect(restored.result.current.receipt).toEqual(receipt);
  expect(next).not.toHaveBeenCalled();
  expect(JSON.stringify(window.sessionStorage)).not.toContain('definition');
});
it('does not restore another session or parallel source-copy flow as the current receipt', async () => {
  const first = renderHook(() =>
    useTemplateCopyAcceptance(
      vi.fn().mockResolvedValue(receipt),
      { scope, lookupReceipt: async () => null },
      sourceCopyAttempt,
    ),
  );
  await act(async () => {
    await first.result.current.accept(request, preview);
  });
  first.unmount();
  for (const owner of [
    { ...scope, sessionId: 'another-session' },
    { ...scope, attemptId: 'another-copy' },
  ]) {
    const lookup = vi.fn().mockResolvedValue(receipt);
    const hook = renderHook(() =>
      useTemplateCopyAcceptance(
        vi.fn(),
        { scope: owner, lookupReceipt: lookup },
        sourceCopyAttempt,
      ),
    );
    await act(async () => {
      await hook.result.current.resume();
    });
    expect(hook.result.current.receipt).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    hook.unmount();
  }
});
