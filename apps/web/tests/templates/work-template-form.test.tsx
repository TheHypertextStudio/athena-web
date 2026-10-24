import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useWorkTemplateForm } from '@/components/templates/use-work-template-form';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  draft: vi.fn(),
  publish: vi.fn(),
  owner: 'test-session',
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.owner }, session: { id: mocks.owner } } }),
}));
let sessionNumber = 0;
beforeEach(() => {
  mocks.owner = `session-${++sessionNumber}`;
  vi.clearAllMocks();
});
afterEach(cleanup);
vi.mock('@/components/templates/work-template-queries', () => ({
  useWorkTemplateWrites: () => ({
    create: { mutateAsync: mocks.create, isPending: false },
    draft: { mutateAsync: mocks.draft, isPending: false },
    publish: { mutateAsync: mocks.publish, isPending: false },
    archive: { isPending: false },
  }),
}));
const definition = {
  name: 'Event',
  payload: { targetType: 'project' as const, description: 'Original' },
};
const initial = WorkTemplateOut.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  targetType: 'project',
  status: 'draft',
  scope: 'personal',
  ownerActorId: null,
  teamId: null,
  isBase: false,
  revision: 3,
  definition,
  draftDefinition: definition,
  offeredTeamIds: [],
  latestVersion: null,
  canEdit: true,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
});
describe('revision-aware template authoring', () => {
  it('prevents two saves before mutation pending state renders', async () => {
    let complete: ((value: unknown) => void) | undefined;
    mocks.draft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result } = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    let first: Promise<void>;
    let second: Promise<void>;
    act(() => {
      first = result.current.save();
      second = result.current.save();
    });
    expect(mocks.draft).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete?.(initial);
      await first;
      await second;
    });
  });

  it('keeps edited prose after a save fails and never publishes implicitly', async () => {
    mocks.draft.mockRejectedValueOnce(new Error('provider detail must stay hidden'));
    const { result } = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    act(() => {
      result.current.setDefinition({
        ...initial.definition,
        payload: { targetType: 'project', description: 'Keep this work' },
      });
    });
    await act(() => result.current.save());
    expect(result.current.definition.payload.description).toBe('Keep this work');
    expect(result.current.error).not.toContain('provider detail');
    expect(result.current.dirty).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('publishes the revision returned by the last successful save', async () => {
    mocks.draft.mockResolvedValueOnce({ ...initial, revision: 4 });
    mocks.publish.mockResolvedValueOnce({ ...initial, revision: 5, status: 'published' });
    const { result } = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    await act(() => result.current.save());
    await act(() => result.current.publish());
    expect(mocks.publish).toHaveBeenCalledWith({ id: initial.id, expectedRevision: 4 });
  });
  it('starts an untouched new draft clean and tracks scope choices as edits', () => {
    const { result } = renderHook(() => useWorkTemplateForm('org', null, vi.fn()));
    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.setScope('team');
    });
    expect(result.current.dirty).toBe(true);
  });

  it('retains unsaved prose across leaving and reopening the same template', () => {
    const first = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    act(() => {
      first.result.current.setDefinition({
        ...initial.definition,
        payload: { targetType: 'project', description: 'Keep through in-app navigation' },
      });
    });
    first.unmount();
    const reopened = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    expect(reopened.result.current.definition.payload.description).toBe(
      'Keep through in-app navigation',
    );
    expect(reopened.result.current.dirty).toBe(true);
  });

  it('retains a new draft and its destination choices without sharing them across workspaces', () => {
    const first = renderHook(() => useWorkTemplateForm('org', null, vi.fn()));
    act(() => {
      first.result.current.setDefinition({
        ...first.result.current.definition,
        name: 'Private outline',
      });
      first.result.current.setScope('team');
      first.result.current.setTeamId('my-team');
    });
    first.unmount();
    const elsewhere = renderHook(() => useWorkTemplateForm('other-org', null, vi.fn()));
    expect(elsewhere.result.current.definition.name).toBe('');
    elsewhere.unmount();
    const resumed = renderHook(() => useWorkTemplateForm('org', null, vi.fn()));
    expect(resumed.result.current.definition.name).toBe('Private outline');
    expect(resumed.result.current.scope).toBe('team');
    expect(resumed.result.current.teamId).toBe('my-team');
  });

  it('clears private retained edits when the authenticated session changes', () => {
    const { result, rerender } = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    act(() => {
      result.current.setDefinition({ ...initial.definition, name: 'Private session edit' });
    });
    mocks.owner = 'replacement-account';
    rerender();
    expect(result.current.definition.name).toBe('Event');
    expect(result.current.dirty).toBe(false);
  });

  it('does not restore a private pending draft after authoring permission is removed', () => {
    const first = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    act(() => {
      first.result.current.setDefinition({ ...initial.definition, name: 'Private pending name' });
    });
    first.unmount();
    const reader = renderHook(() =>
      useWorkTemplateForm(
        'org',
        {
          ...initial,
          status: 'published',
          canEdit: false,
          draftDefinition: undefined,
        },
        vi.fn(),
      ),
    );
    expect(reader.result.current.definition.name).toBe('Event');
    expect(reader.result.current.canEdit).toBe(false);
  });

  it('forgets retained edits after a successful save', async () => {
    const updated = {
      ...initial,
      revision: 4,
      definition: { ...initial.definition, name: 'Saved outline' },
      draftDefinition: { ...initial.definition, name: 'Saved outline' },
    };
    mocks.draft.mockResolvedValueOnce(updated);
    const first = renderHook(() => useWorkTemplateForm('org', initial, vi.fn()));
    act(() => {
      first.result.current.setDefinition(updated.definition);
    });
    await act(() => first.result.current.save());
    first.unmount();
    const reopened = renderHook(() => useWorkTemplateForm('org', updated, vi.fn()));
    expect(reopened.result.current.definition.name).toBe('Saved outline');
    expect(reopened.result.current.dirty).toBe(false);
  });
  it('ignores a creation response after the account changed', async () => {
    let complete: ((value: unknown) => void) | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const onCreated = vi.fn();
    const { result, rerender } = renderHook(() => useWorkTemplateForm('org', null, onCreated));
    act(() => {
      result.current.setDefinition({ ...result.current.definition, name: 'Private creation' });
    });
    let saving: Promise<void> | undefined;
    act(() => {
      saving = result.current.save();
    });
    mocks.owner = 'another-account';
    rerender();
    await act(async () => {
      complete?.(initial);
      await saving;
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(result.current.definition.name).toBe('');
    expect(result.current.saved).toBe(false);
  });
  it.each(['create', 'publish'] as const)(
    'ignores a delayed %s response after the editor unmounts',
    async (operation) => {
      let complete: ((value: unknown) => void) | undefined;
      mocks[operation].mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const onCreated = vi.fn();
      const onPublished = vi.fn();
      const editor = renderHook(() =>
        useWorkTemplateForm('org', operation === 'create' ? null : initial, onCreated, onPublished),
      );
      if (operation === 'create')
        act(() => {
          editor.result.current.setDefinition({
            ...editor.result.current.definition,
            name: 'Private creation',
          });
        });
      let pending: Promise<void> | undefined;
      act(() => {
        pending =
          operation === 'create' ? editor.result.current.save() : editor.result.current.publish();
      });
      editor.unmount();
      await act(async () => {
        complete?.(initial);
        await pending;
      });
      expect(onCreated).not.toHaveBeenCalled();
      expect(onPublished).not.toHaveBeenCalled();
    },
  );
});
