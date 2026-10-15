import type * as QueryModule from '@/lib/query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCommandActions } from '@/components/command-palette/use-command-actions';
const mocks = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
vi.mock('@docket/ui/hooks', () => ({ useVocabulary: (kind: string) => kind }));
vi.mock('@/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: mocks.create }),
}));
vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [],
    activeOrgId: 'org',
    defaultTeamId: 'team',
    orgName: () => 'Community',
  }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'user' } } }) },
}));
vi.mock('@/lib/query', async (original) => ({
  ...(await original<typeof QueryModule>()),
  useApiListQuery: () => ({ data: { items: [{ actorId: 'actor', userId: 'user' }] } }),
  useApiQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: {
      items: queryKey.includes('definitions')
        ? [
            { id: 'event', offeredTeamIds: ['team'] },
            { id: 'restricted', offeredTeamIds: ['another-team'] },
          ]
        : [
            { id: 'event', targetType: 'project', name: 'Event', scope: 'organization' },
            { id: 'restricted', targetType: 'project', name: 'Restricted', scope: 'organization' },
            {
              id: 'personal',
              targetType: 'task',
              name: 'My outline',
              scope: 'personal',
              ownerActorId: 'actor',
            },
          ],
    },
  }),
}));
describe('template command discovery', () => {
  it('offers published New Event and private-draft commands in the current team context', () => {
    const { result } = renderHook(() => useCommandActions({ open: true, close: mocks.close }));
    expect(result.current.map((item) => item.label)).toEqual([
      'New Event',
      'New task from My outline · Draft',
    ]);
    result.current.find((item) => item.label === 'New Event')?.run();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'project',
        defaultTemplateId: 'event',
        initialWorkspaceId: 'org',
      }),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
