/**
 * Which draft a global composer reopens: the launcher's choice, the pointer a navigation left, or,
 * with the preference on, the newest draft of that kind in the destination workspace. The answer
 * is decided once per open, the preference is waited for rather than read as off while it loads,
 * and the host waits for the drafts list only when a resume is possible.
 */
import type { ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../support/deferred';

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

/** Render the hook against a cold cache, as the first composer open after a page load is. */
function renderResume(requestDraftId: string | null = null) {
  const { wrapper } = makeQueryWrapper();
  return renderHook(() => useResumeDraft('task', requestDraftId, ORG_ID, true), { wrapper });
}

beforeEach(() => {
  window.sessionStorage.clear();
  preferencesGet.mockReset();
  draftsGet.mockReset();
});

afterEach(cleanup);

describe('useResumeDraft', () => {
  it('opens empty without waiting for the drafts list when the preference is off', async () => {
    const list = deferred<Response>();
    preferencesGet.mockResolvedValue(jsonResponse(true, {}));
    draftsGet.mockReturnValue(list.promise);
    const { result } = renderResume();

    // Ready as soon as the preference says off, while the drafts list is still in flight.
    await waitFor(() => {
      expect(result.current).toEqual({ draftId: null, ready: true });
    });
    list.resolve(jsonResponse(true, { items: [draft('draft_a', 'task')] }));
    await waitFor(() => {
      expect(draftsGet).toHaveBeenCalled();
    });
    expect(result.current).toEqual({ draftId: null, ready: true });
  });

  it('waits for a preference still loading instead of reading it as off', async () => {
    const preference = deferred<Response>();
    preferencesGet.mockReturnValue(preference.promise);
    draftsGet.mockResolvedValue(jsonResponse(true, { items: [draft('draft_newest', 'task')] }));
    const { result } = renderResume();

    // Held: not ready, and no draft chosen, while the preference is unknown.
    await waitFor(() => {
      expect(preferencesGet).toHaveBeenCalled();
    });
    expect(result.current).toEqual({ draftId: null, ready: false });

    preference.resolve(jsonResponse(true, { composer: { resumeDrafts: true } }));
    await waitFor(() => {
      expect(result.current).toEqual({ draftId: 'draft_newest', ready: true });
    });
  });

  it('honours the launcher’s draft over everything else, once the list has settled', async () => {
    serve(true, [draft('draft_new', 'task')]);
    writeInterruptedDraft('task', 'draft_pointer');
    const { result } = renderResume('draft_requested');

    expect(result.current.draftId).toBe('draft_requested');
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.draftId).toBe('draft_requested');
  });

  it('reopens the draft a navigation interrupted, and only once', () => {
    serve(false, []);
    writeInterruptedDraft('task', 'draft_pointer');
    const first = renderResume();

    expect(first.result.current.draftId).toBe('draft_pointer');
    first.unmount();

    const second = renderResume();
    expect(second.result.current.draftId).toBeNull();
  });

  it('resumes the newest draft of this kind in this workspace when the preference is on', async () => {
    serve(true, [
      draft('draft_other_org', 'task', OTHER_ORG_ID),
      draft('draft_project', 'project'),
      draft('draft_newest', 'task'),
      draft('draft_older', 'task'),
    ]);
    const { result } = renderResume();

    await waitFor(() => {
      expect(result.current).toEqual({ draftId: 'draft_newest', ready: true });
    });
  });

  it('opens empty when the preference is on but there is nothing of this kind to resume', async () => {
    serve(true, [draft('draft_project', 'project')]);
    const { result } = renderResume();

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.draftId).toBeNull();
  });

  it('treats a preference that failed to load as off', async () => {
    preferencesGet.mockRejectedValue(new Error('offline'));
    draftsGet.mockResolvedValue(jsonResponse(true, { items: [draft('draft_a', 'task')] }));
    const { result } = renderResume();

    await waitFor(() => {
      expect(result.current).toEqual({ draftId: null, ready: true });
    });
  });
});
