import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterInitiativeActions } from '../../../src/components/initiatives/initiative-actions';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import type { ObjectRef } from '../../../src/lib/actions/object';
import { createActionRegistry } from '../../../src/lib/actions/registry';
import type * as InitiativeHierarchyMutations from '../../../src/components/initiatives/initiative-hierarchy-mutations';
import { makeQueryWrapper } from '../../support/query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const open = vi.fn();
vi.mock('../../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

vi.mock('../../../src/components/initiatives/initiative-hierarchy-mutations', async () => {
  const actual = await vi.importActual<typeof InitiativeHierarchyMutations>(
    '../../../src/components/initiatives/initiative-hierarchy-mutations',
  );
  return { ...actual, writeInitiativeHierarchyMutation: vi.fn().mockResolvedValue(undefined) };
});

function Registration(): null {
  useRegisterInitiativeActions();
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
  return registry;
}

const child: ObjectRef = {
  kind: 'initiative',
  id: 'child',
  organizationId: 'org-1',
  title: 'Membership portal',
  meta: { parentInitiativeId: 'root', parentLinkId: 'link-child' },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Initiative actions', () => {
  it('registers one Initiative action set for navigation and hierarchy editing', () => {
    const registry = setup();
    expect(registry.snapshot().ids).toEqual([
      'initiative.addSubinitiative',
      'initiative.changeParent',
      'initiative.copy',
      'initiative.moveToTopLevel',
      'initiative.open',
    ]);
  });

  it('opens the same hierarchy picker for parent and child operations', async () => {
    const registry = setup();
    const context = {
      objects: [child],
      source: 'context-menu' as const,
      organizationId: 'org-1',
    };

    await registry.invoke('initiative.changeParent', () => context);
    expect(open).toHaveBeenLastCalledWith({
      kind: 'initiative-hierarchy',
      mode: 'parent',
      organizationId: 'org-1',
      subject: child,
    });

    await registry.invoke('initiative.addSubinitiative', () => context);
    expect(open).toHaveBeenLastCalledWith({
      kind: 'initiative-hierarchy',
      mode: 'child',
      organizationId: 'org-1',
      subject: child,
    });
  });

  it('only offers move to top level when the Initiative has a parent edge', () => {
    const registry = setup();
    const nested = registry.resolve(() => ({
      objects: [child],
      source: 'context-menu',
      organizationId: 'org-1',
    }));
    const root = registry.resolve(() => ({
      objects: [{ ...child, meta: { parentInitiativeId: null, parentLinkId: null } }],
      source: 'context-menu',
      organizationId: 'org-1',
    }));

    expect(nested.map((action) => action.id)).toContain('initiative.moveToTopLevel');
    expect(root.map((action) => action.id)).not.toContain('initiative.moveToTopLevel');
  });
});
