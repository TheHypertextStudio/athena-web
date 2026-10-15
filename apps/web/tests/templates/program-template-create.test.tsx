import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgramTemplateCreate } from '@/components/programs/program-template-create';
const mocks = vi.hoisted(() => ({ openCreate: vi.fn() }));
vi.mock('@/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: mocks.openCreate }),
}));
vi.mock('@/components/templates/work-template-queries', () => ({ workTemplatesDef: () => ({}) }));
vi.mock('@/lib/query', () => ({
  useApiQuery: () => ({
    data: {
      items: [
        { id: 'event', isBase: false, definition: { name: 'Event' }, offeredTeamIds: [] },
        {
          id: 'other-team',
          isBase: false,
          definition: { name: 'Restricted' },
          offeredTeamIds: ['other'],
        },
        { id: 'base', isBase: true, definition: { name: 'Blank project' }, offeredTeamIds: [] },
      ],
    },
    isPending: false,
    isError: false,
  }),
}));
describe('Program template creation', () => {
  it('opens the ordinary project composer with a selected publication and containing Program', async () => {
    render(<ProgramTemplateCreate orgId="org" programId="program" onCreated={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'New from template' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    expect(
      screen.queryByRole('menuitem', { name: /Restricted|Blank project/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New Event' }));
    expect(mocks.openCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'project',
        initialWorkspaceId: 'org',
        defaultProgramId: 'program',
        defaultTemplateId: 'event',
        sameWorkspaceCompletion: 'stay',
      }),
    );
  });
});
