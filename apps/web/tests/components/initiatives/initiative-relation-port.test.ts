import { describe, expect, it, vi } from 'vitest';

import { createInitiativeParentCommandPort } from '../../../src/components/initiatives/initiative-relation-port';

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
            organizationId: 'org-1',
            meta: { parentInitiativeId: 'old-parent', parentLinkId: 'edge-1' },
          },
        ],
        target: { kind: 'initiative', id: 'new-parent', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'applied' });

    expect(write).toHaveBeenCalledWith('org-1', {
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
