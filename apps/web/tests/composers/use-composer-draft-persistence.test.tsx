import type { ComposerDraftOut, ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { draftsGet, draftPost, draftGet, draftPatch, draftDelete } = vi.hoisted(() => ({
  draftsGet: vi.fn(),
  draftPost: vi.fn(),
  draftGet: vi.fn(),
  draftPatch: vi.fn(),
  draftDelete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      me: {
        drafts: Object.assign(
          { $get: draftsGet, $post: draftPost },
          { ':id': { $get: draftGet, $patch: draftPatch, $delete: draftDelete } },
        ),
      },
    },
  },
}));

import { useComposerDraftPersistence } from '@/components/composer/use-composer-draft-persistence';

import { jsonResponse } from '../support/http';
import { makeQueryWrapper } from '../support/query';

const ORG_ID = '0RG00000000000000000000001';

/** The composer draft the hook persists in these tests. */
interface FakeDraft {
  title: string;
  description: string;
}

function serialize(draft: FakeDraft): ComposerDraftPayload {
  return { kind: 'task', title: draft.title, description: draft.description };
}

function hydrate(payload: ComposerDraftPayload): Partial<FakeDraft> {
  if (payload.kind !== 'task') return {};
  return { title: payload.title ?? '', description: payload.description ?? '' };
}

function row(overrides: Partial<ComposerDraftOut> = {}): ComposerDraftOut {
  const now = new Date().toISOString();
  return {
    id: 'draft_1',
    organizationId: ORG_ID,
    kind: 'task',
    revision: 0,
    payload: { kind: 'task', title: 'Grant report', description: '' },
    title: 'Grant report',
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    ...overrides,
  } as ComposerDraftOut;
}

/** A 412 refusal as the API sends it. */
function staleRevision(): Response {
  return new Response(JSON.stringify({ code: 'precondition_failed', status: 412 }), {
    status: 412,
    headers: { 'content-type': 'application/problem+json' },
  });
}

interface HarnessProps {
  readonly draft: FakeDraft;
  readonly enabled?: boolean;
  readonly resumeDraftId?: string | null;
}

function renderPersistence(initial: HarnessProps) {
  const updateDraft = vi.fn();
  const { wrapper } = makeQueryWrapper();
  const hook = renderHook(
    ({ draft, enabled = true, resumeDraftId = null }: HarnessProps) =>
      useComposerDraftPersistence<FakeDraft>({
        kind: 'task',
        orgId: ORG_ID,
        enabled,
        draft,
        isDirty: draft.title.trim().length > 0 || draft.description.trim().length > 0,
        serialize,
        hydrate,
        updateDraft,
        resumeDraftId,
      }),
    { wrapper, initialProps: initial },
  );
  return { ...hook, updateDraft };
}

/** The wire payload an RPC mock was called with. */
interface DraftWrite {
  readonly json: { readonly payload: ComposerDraftPayload; readonly revision?: number };
}

/** Answer a create with a row carrying the payload that was sent, as the server would. */
function echoCreate(call: DraftWrite): Promise<Response> {
  const title = call.json.payload.kind === 'task' ? (call.json.payload.title ?? null) : null;
  return Promise.resolve(jsonResponse(true, row({ payload: call.json.payload, title })));
}

/** Answer a write with the next revision and the payload that was sent. */
function echoPatch(call: DraftWrite): Promise<Response> {
  return Promise.resolve(
    jsonResponse(
      true,
      row({ payload: call.json.payload, revision: (call.json.revision ?? 0) + 1 }),
    ),
  );
}

/** Let the hook's queued promise work settle without moving the clock. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  draftsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  draftPost.mockReset().mockImplementation(echoCreate);
  draftGet.mockReset().mockResolvedValue(jsonResponse(true, row()));
  draftPatch.mockReset().mockImplementation(echoPatch);
  draftDelete.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useComposerDraftPersistence', () => {
  it('creates the row after the quiet period, then patches later edits against its revision', async () => {
    const { rerender, result } = renderPersistence({ draft: { title: '', description: '' } });

    // Property picks alone are not dirty, so nothing is written.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(draftPost).not.toHaveBeenCalled();

    rerender({ draft: { title: 'Grant', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(draftPost).toHaveBeenCalledOnce();
    expect(draftPost.mock.calls[0]?.[0]).toMatchObject({
      json: { organizationId: ORG_ID, kind: 'task', payload: { title: 'Grant' } },
    });
    await flush();
    expect(result.current.controls.currentId).toBe('draft_1');

    rerender({ draft: { title: 'Grant report', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(draftPatch).toHaveBeenCalledOnce();
    expect(draftPatch.mock.calls[0]?.[0]).toMatchObject({
      param: { id: 'draft_1' },
      json: { revision: 0, payload: { title: 'Grant report' } },
    });
    expect(draftPost).toHaveBeenCalledOnce();
  });

  it('rebases once when the revision is stale', async () => {
    draftPatch.mockResolvedValueOnce(staleRevision()).mockImplementationOnce(echoPatch);
    draftGet.mockResolvedValue(jsonResponse(true, row({ revision: 3 })));
    const { rerender } = renderPersistence({ draft: { title: 'Grant', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await flush();

    rerender({ draft: { title: 'Grant report', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(draftPatch).toHaveBeenCalledTimes(2);
    expect(draftPatch.mock.calls[1]?.[0]).toMatchObject({ json: { revision: 3 } });
  });

  it('deletes the row on Discard and keeps it on Save draft', async () => {
    const first = renderPersistence({ draft: { title: 'Grant', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await act(async () => {
      await first.result.current.controls.onDiscard();
    });
    expect(draftDelete).toHaveBeenCalledWith({ param: { id: 'draft_1' } });
    cleanup();

    draftDelete.mockClear();
    const second = renderPersistence({ draft: { title: 'Grant', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await act(async () => {
      await second.result.current.controls.onKeep();
    });
    expect(draftDelete).not.toHaveBeenCalled();
  });

  it('deletes the row on commit and starts a new one for the next dirty draft', async () => {
    const { rerender, result } = renderPersistence({ draft: { title: 'Grant', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(draftDelete).toHaveBeenCalledOnce();

    draftPost.mockImplementation((call: DraftWrite) =>
      Promise.resolve(jsonResponse(true, row({ id: 'draft_2', payload: call.json.payload }))),
    );
    rerender({ draft: { title: '', description: '' } });
    rerender({ draft: { title: 'Next', description: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await flush();
    expect(draftPost).toHaveBeenCalledTimes(2);
    expect(result.current.controls.currentId).toBe('draft_2');
  });

  it('pours a requested draft into the composer once on mount', async () => {
    draftGet.mockResolvedValue(jsonResponse(true, row({ id: 'draft_9', revision: 2 })));
    const { result, updateDraft } = renderPersistence({
      draft: { title: '', description: '' },
      resumeDraftId: 'draft_9',
    });

    await flush();
    await flush();
    expect(updateDraft).toHaveBeenCalledOnce();
    const recipe = updateDraft.mock.calls[0]?.[0] as (current: FakeDraft) => Partial<FakeDraft>;
    expect(recipe({ title: '', description: '' })).toEqual({
      title: 'Grant report',
      description: '',
    });
    expect(result.current.loadGeneration).toBe(1);
    expect(result.current.controls.currentId).toBe('draft_9');
    // Loading is not a write.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(draftPost).not.toHaveBeenCalled();
    expect(draftPatch).not.toHaveBeenCalled();
  });
});
