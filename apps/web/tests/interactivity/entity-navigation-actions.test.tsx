import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterEntityNavigationActions } from '../../src/components/actions/entity-navigation-actions';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import { createActionRegistry } from '../../src/lib/actions/registry';
import { makeQueryWrapper, okResponse, problemResponse } from '../support/query';

const { linkProjectToInitiative, linkProgramToInitiative, invalidateWorkTargetQueries } =
  vi.hoisted(() => ({
    linkProjectToInitiative: vi.fn(),
    linkProgramToInitiative: vi.fn(),
    invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            ':id': {
              projects: { $post: linkProjectToInitiative },
              programs: { $post: linkProgramToInitiative },
            },
          },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open: vi.fn() }),
}));

function Registration(): null {
  useRegisterEntityNavigationActions();
  return null;
}

function setup() {
  const registry = createActionRegistry();
  const { client } = makeQueryWrapper();
  render(
    <QueryClientProvider client={client}>
      <InteractionProvider registry={registry}>
        <Registration />
      </InteractionProvider>
    </QueryClientProvider>,
  );
  return { client, registry };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Project navigation actions', () => {
  it('writes through the Project owner and refreshes both relation projections', async () => {
    linkProjectToInitiative.mockResolvedValue(okResponse({}));
    const { client, registry } = setup();

    await registry.invoke('project.linkInitiative', () => ({
      objects: [
        {
          kind: 'project',
          id: 'project-1',
          organizationId: 'org-b',
          title: 'Foreign project',
        },
      ],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-b',
        title: 'Same-owner initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(linkProjectToInitiative).toHaveBeenCalledWith({
      param: { orgId: 'org-b', id: 'initiative-1' },
      json: { projectId: 'project-1' },
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'project',
      ownerOrganizationId: 'org-b',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });

  it('rejects a cross-organization Initiative link before the API write', async () => {
    const { registry } = setup();

    await registry.invoke('project.linkInitiative', () => ({
      objects: [{ kind: 'project', id: 'project-1', organizationId: 'org-b', title: 'Project' }],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-a',
        title: 'Foreign initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(linkProjectToInitiative).not.toHaveBeenCalled();
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('does not refresh projections for an unchanged duplicate relation', async () => {
    linkProjectToInitiative.mockResolvedValue(problemResponse('duplicate relation', 409));
    const { registry } = setup();

    const result = await registry.invoke('project.linkInitiative', () => ({
      objects: [
        {
          kind: 'project',
          id: 'project-1',
          organizationId: 'org-b',
          title: 'Project',
        },
      ],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-b',
        title: 'Initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(result.status).toBe('ran');
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('refreshes every eligible projection when a later Project write fails', async () => {
    linkProjectToInitiative
      .mockResolvedValueOnce(okResponse({}))
      .mockRejectedValueOnce(new Error('second Project write failed'));
    const { client, registry } = setup();

    const result = await registry.invoke('project.linkInitiative', () => ({
      objects: [
        { kind: 'project', id: 'project-1', organizationId: 'org-b', title: 'First project' },
        { kind: 'project', id: 'project-2', organizationId: 'org-b', title: 'Second project' },
      ],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-b',
        title: 'Initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(result.status).toBe('failed');
    expect(linkProjectToInitiative).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'project',
      ownerOrganizationId: 'org-b',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });
});

describe('Program navigation actions', () => {
  it('refreshes Program and Initiative projections after a same-owner link', async () => {
    linkProgramToInitiative.mockResolvedValue(okResponse({}));
    const { client, registry } = setup();

    await registry.invoke('program.linkInitiative', () => ({
      objects: [{ kind: 'program', id: 'program-1', organizationId: 'org-b', title: 'Program' }],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-b',
        title: 'Initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(linkProgramToInitiative).toHaveBeenCalledWith({
      param: { orgId: 'org-b', id: 'initiative-1' },
      json: { programId: 'program-1' },
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: 'org-b',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });

  it('refreshes every eligible projection when a later Program write fails', async () => {
    linkProgramToInitiative
      .mockResolvedValueOnce(okResponse({}))
      .mockRejectedValueOnce(new Error('second Program write failed'));
    const { client, registry } = setup();

    const result = await registry.invoke('program.linkInitiative', () => ({
      objects: [
        { kind: 'program', id: 'program-1', organizationId: 'org-b', title: 'First program' },
        { kind: 'program', id: 'program-2', organizationId: 'org-b', title: 'Second program' },
      ],
      target: {
        kind: 'initiative',
        id: 'initiative-1',
        organizationId: 'org-b',
        title: 'Initiative',
      },
      source: 'drag',
      organizationId: 'org-a',
    }));

    expect(result.status).toBe('failed');
    expect(linkProgramToInitiative).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: 'org-b',
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: 'org-b',
    });
  });
});
