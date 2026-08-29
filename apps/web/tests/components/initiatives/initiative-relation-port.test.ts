import { describe, expect, it, vi } from 'vitest';

import {
  createInitiativeParentCommandPort,
  createInitiativePropertyCommandPort,
} from '../../../src/components/initiatives/initiative-relation-port';

describe('Initiative parent relation port', () => {
  it('moves an existing hierarchy edge through the Initiative-owned adapter', async () => {
    const write = vi.fn(async () => undefined);
    const port = createInitiativeParentCommandPort({ write });

    await expect(
      port.execute({
        relationId: 'initiative.parent',
        effect: 'move',
        subjects: [
          {
            kind: 'initiative',
            id: 'child',
            organizationId: 'org-b',
            meta: { parentInitiativeId: 'old-parent', parentLinkId: 'edge-1' },
          },
        ],
        target: { kind: 'initiative', id: 'new-parent', organizationId: 'org-a' },
      }),
    ).resolves.toEqual({ status: 'applied' });

    expect(write).toHaveBeenCalledWith('org-a', {
      kind: 'move',
      linkId: 'edge-1',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
  });

  it('detaches a nested Initiative through the same port when the target is top level', async () => {
    const write = vi.fn(async () => undefined);
    const port = createInitiativeParentCommandPort({ write });

    await expect(
      port.execute({
        relationId: 'initiative.root',
        effect: 'move',
        subjects: [
          {
            kind: 'initiative',
            id: 'child',
            organizationId: 'org-1',
            meta: { parentInitiativeId: 'parent', parentLinkId: 'link-1' },
          },
        ],
        target: {
          kind: 'initiative_root',
          id: 'org-1:initiative-root',
          organizationId: 'org-1',
        },
      }),
    ).resolves.toEqual({ status: 'applied' });
    expect(write).toHaveBeenCalledWith('org-1', {
      kind: 'detach',
      linkId: 'link-1',
      childInitiativeId: 'child',
    });
  });

  it('treats an unchanged parent as a successful no-op', async () => {
    const write = vi.fn(async () => undefined);
    const port = createInitiativeParentCommandPort({ write });

    await expect(
      port.execute({
        relationId: 'initiative.parent',
        effect: 'move',
        subjects: [
          {
            kind: 'initiative',
            id: 'child',
            organizationId: 'org-1',
            meta: { parentInitiativeId: 'parent', parentLinkId: 'edge-1' },
          },
        ],
        target: { kind: 'initiative', id: 'parent', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'unchanged' });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('Initiative property relation port', () => {
  it('maps every same-owner property relation to its Initiative operation', async () => {
    const setProperty = vi.fn(async () => undefined);
    const addLabel = vi.fn(async () => 'applied' as const);
    const port = createInitiativePropertyCommandPort({ setProperty, addLabel });
    const subject = { kind: 'initiative' as const, id: 'initiative-1', organizationId: 'org-b' };

    await port.execute({
      relationId: 'initiative.owner',
      effect: 'move',
      subjects: [subject],
      target: { kind: 'actor', id: 'actor-1', organizationId: 'org-b' },
    });
    await port.execute({
      relationId: 'initiative.lead-team',
      effect: 'move',
      subjects: [subject],
      target: { kind: 'team', id: 'team-1', organizationId: 'org-b' },
    });
    await port.execute({
      relationId: 'initiative.label',
      effect: 'link',
      subjects: [subject],
      target: { kind: 'label', id: 'label-1', organizationId: 'org-b' },
    });

    expect(setProperty).toHaveBeenNthCalledWith(1, 'org-b', 'initiative-1', {
      ownerId: 'actor-1',
    });
    expect(setProperty).toHaveBeenNthCalledWith(2, 'org-b', 'initiative-1', {
      leadTeamId: 'team-1',
    });
    expect(addLabel).toHaveBeenCalledWith('org-b', 'initiative-1', 'label-1');
  });

  it.each([
    ['initiative.owner', 'actor'] as const,
    ['initiative.lead-team', 'team'] as const,
    ['initiative.label', 'label'] as const,
  ])('rejects a cross-organization %s relation before writing', async (relationId, targetKind) => {
    const setProperty = vi.fn(async () => undefined);
    const addLabel = vi.fn(async () => 'applied' as const);
    const port = createInitiativePropertyCommandPort({ setProperty, addLabel });

    await expect(
      port.execute({
        relationId,
        effect: relationId === 'initiative.label' ? 'link' : 'move',
        subjects: [{ kind: 'initiative', id: 'initiative-1', organizationId: 'org-b' }],
        target: { kind: targetKind, id: 'target-1', organizationId: 'org-a' },
      }),
    ).resolves.toEqual({ status: 'unchanged' });

    expect(setProperty).not.toHaveBeenCalled();
    expect(addLabel).not.toHaveBeenCalled();
  });
});
