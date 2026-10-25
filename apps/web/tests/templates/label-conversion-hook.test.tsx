import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversionCommand } from '@/components/templates/label-conversion/use-command';
import { LabelTemplateConversionChoices } from '@docket/work/work-template-contract';
import { saveConversionAttempt } from '@/components/templates/label-conversion/command';
const mocks = vi.hoisted(() => ({
  user: 'person',
  session: 'session-a',
  preview: vi.fn(),
  confirm: vi.fn(),
  undo: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.user }, session: { id: mocks.session } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => client }));
const client = { fetchQuery: mocks.lookup };
vi.mock('@/components/templates/label-conversion/queries', () => ({
  conversionReceiptDef: (_org: string, id: string) => ({ id }),
  useConversionTransport: () => ({
    preview: { mutateAsync: mocks.preview },
    confirm: { mutateAsync: mocks.confirm },
    undo: { mutateAsync: mocks.undo },
  }),
}));
const ids = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
];
const choices = LabelTemplateConversionChoices.parse({
  labelGroupId: ids[0],
  items: [
    {
      kind: 'task',
      id: ids[1],
      removeLabelIds: [ids[2]],
      workTypeId: ids[3],
      workTypeVersionId: ids[4],
    },
  ],
});
const review = {
  labelGroupId: ids[0],
  labelGroupName: 'Kinds',
  reviewFingerprint: `sha256:${'1'.repeat(64)}`,
  items: [],
};
const receipt = { changeSetId: 'saved', state: 'converted' as const, itemCount: 1 };
const scope = () => ({
  userId: mocks.user,
  sessionId: mocks.session,
  orgId: 'org',
  templateId: 'template',
  versionId: 'version',
});
beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  mocks.session = 'session-a';
  mocks.preview.mockResolvedValue(review);
  mocks.confirm.mockResolvedValue(receipt);
});
afterEach(cleanup);
describe('focused conversion command ownership', () => {
  it('retains real review data and admits only one confirm before pending state renders', async () => {
    let resolve: ((value: typeof receipt) => void) | undefined;
    mocks.confirm.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useConversionCommand('org', 'template', 'version'));
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    await act(() => result.current.prepareReview(choices));
    expect(result.current.review).toEqual(review);
    let first: Promise<void>, second: Promise<void>;
    act(() => {
      first = result.current.confirm(choices);
      second = result.current.confirm(choices);
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await act(async () => {
      resolve?.(receipt);
      await first;
      await second;
    });
    expect(result.current.receipt).toEqual(receipt);
  });
  it('reconciles saved outcomes before allowing a source review', async () => {
    saveConversionAttempt(scope(), choices, review.reviewFingerprint);
    mocks.lookup.mockResolvedValue(receipt);
    const { result } = renderHook(() => useConversionCommand('org', 'template', 'version'));
    await waitFor(() => {
      expect(result.current.receipt).toEqual(receipt);
    });
    await act(() => result.current.prepareReview(choices));
    expect(result.current.ready).toBe(false);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('blocks another review while the original outcome is unknown', async () => {
    saveConversionAttempt(scope(), choices, review.reviewFingerprint);
    mocks.lookup.mockRejectedValue(new TypeError('offline'));
    const { result } = renderHook(() => useConversionCommand('org', 'template', 'version'));
    await waitFor(() => {
      expect(result.current.phase).toBe('unknown');
    });
    await act(() => result.current.prepareReview(choices));
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('ignores the prior session’s in-flight reviewed content after account context changes', async () => {
    let resolve: ((value: typeof review) => void) | undefined;
    mocks.preview.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(() =>
      useConversionCommand('org', 'template', 'version'),
    );
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    let pending: Promise<void>;
    act(() => {
      pending = result.current.prepareReview(choices);
    });
    mocks.session = 'session-b';
    rerender();
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    await act(async () => {
      resolve?.(review);
      await pending;
    });
    expect(result.current.review).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
