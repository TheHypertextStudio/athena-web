/**
 * Which draft a global composer reopens: the launcher's choice, the pointer a navigation left, or,
 * with the preference on, the newest draft of that kind in the destination workspace. The answer
 * is decided once per open, and the host waits for the drafts list only when a resume is possible.
 */
import type { ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { preferencesGet, draftsGet } = vi.hoisted(() => ({
  preferencesGet: vi.fn(),
  draftsGet: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      hub: { preferences: { $get: preferencesGet } },
      me: { drafts: { $get: draftsGet } },
    },
  },
}));

import { writeInterruptedDraft } from '@/components/create-object/interrupted-draft';
import { useResumeDraft } from '@/components/create-object/use-resume-draft';

import { jsonResponse } from '../support/http';
import { makeQueryWrapper } from '../support/query';

const ORG_ID = '0RG00000000000000000000001';
const OTHER_ORG_ID = '0RG00000000000000000000002';

/** A draft row as the API lists it. */
function draft(id: string, kind: ComposerDraftOut['kind'], organizationId = ORG_ID) {
  const now = new Date().toISOString();
  return {
    id,
    organizationId,
    kind,
    revision: 0,
    payload: { kind },
    title: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
  } as ComposerDraftOut;
}

/** Answer the two reads the hook makes. */
function serve(resumeDrafts: boolean, items: readonly ComposerDraftOut[]): void {
  preferencesGet.mockResolvedValue(
    jsonResponse(true, { composer: resumeDrafts ? { resumeDrafts: true } : {} }),
  );
  draftsGet.mockResolvedValue(jsonResponse(true, { items }));
}

/** Render the hook with the preference read already in the cache, as the app has by open time. */
function renderResume(
  kind: 'task' | 'project',
  requestDraftId: string | null,
  orgId: string | null,
  ready = true,
) {
  const { wrapper } = makeQueryWrapper();
  return renderHook(() => useResumeDraft(kind, requestDraftId, orgId, ready), { wrapper });
}

beforeEach(() => {
  window.sessionStorage.clear();
  preferencesGet.mockReset();
  draftsGet.mockReset();
});

afterEach(cleanup);

describe('useResumeDraft', () => {
  it('opens empty and never waits for the drafts list when the preference is off', async () => {
    serve(false, [draft('draft_a', 'task')]);
    const { result } = renderResume('task', null, ORG_ID);

    expect(result.current).toEqual({ draftId: null, ready: true });
    // Give both reads time to land; the answer must not change.
    await waitFor(() => {
      expect(draftsGet).toHaveBeenCalled();
    });
    expect(result.current).toEqual({ draftId: null, ready: true });
  });

  it('honours the launcher’s draft over everything else, once the list has settled', async () => {
    serve(true, [draft('draft_new', 'task')]);
    writeInterruptedDraft('task', 'draft_pointer');
    const { result } = renderResume('task', 'draft_requested', ORG_ID);

    expect(result.current.draftId).toBe('draft_requested');
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.draftId).toBe('draft_requested');
  });

  it('reopens the draft a navigation interrupted, and only once', async () => {
    serve(false, []);
    writeInterruptedDraft('task', 'draft_pointer');
    const first = renderResume('task', null, ORG_ID);

    expect(first.result.current.draftId).toBe('draft_pointer');
    first.unmount();

    const second = renderResume('task', null, ORG_ID);
    expect(second.result.current.draftId).toBeNull();
  });

  it('resumes the newest draft of this kind in this workspace when the preference is on', async () => {
    serve(true, [
      draft('draft_other_org', 'task', OTHER_ORG_ID),
      draft('draft_project', 'project'),
      draft('draft_newest', 'task'),
      draft('draft_older', 'task'),
    ]);
    // The preference resolves to off until it has loaded, so prime it as the shell already has.
    const { wrapper } = makeQueryWrapper();
    const warm = renderHook(() => useResumeDraft('task', null, ORG_ID, true), { wrapper });
    await waitFor(() => {
      expect(preferencesGet).toHaveBeenCalled();
    });
    warm.unmount();

    const { result } = renderHook(() => useResumeDraft('task', null, ORG_ID, true), { wrapper });

    // Not ready while the list settles, so the composer never mounts blank and then jumps.
    await waitFor(() => {
      expect(result.current).toEqual({ draftId: 'draft_newest', ready: true });
    });
  });

  it('opens empty when the preference is on but there is nothing of this kind to resume', async () => {
    serve(true, [draft('draft_project', 'project')]);
    const { wrapper } = makeQueryWrapper();
    const warm = renderHook(() => useResumeDraft('task', null, ORG_ID, true), { wrapper });
    await waitFor(() => {
      expect(preferencesGet).toHaveBeenCalled();
    });
    warm.unmount();

    const { result } = renderHook(() => useResumeDraft('task', null, ORG_ID, true), { wrapper });

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.draftId).toBeNull();
  });
});
