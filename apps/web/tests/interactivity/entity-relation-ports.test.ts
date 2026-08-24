import { describe, expect, it, vi } from 'vitest';

import { createProgramRelationCommandPort } from '../../src/components/programs/program-relation-port';
import { createProjectRelationCommandPort } from '../../src/components/projects/project-relation-port';

describe('Project relation command port', () => {
  it('maps every Project relation to the owning application operation', async () => {
    const dependencies = {
      patchProject: vi.fn(async () => undefined),
      linkInitiative: vi.fn(async () => 'applied' as const),
      addLabel: vi.fn(async () => 'unchanged' as const),
      addDependency: vi.fn(async () => 'applied' as const),
    };
    const port = createProjectRelationCommandPort(dependencies);
    const subject = { kind: 'project' as const, id: 'project-1', organizationId: 'org-1' };

    await port.execute({
      relationId: 'project.program',
      effect: 'move',
      subjects: [subject],
      target: { kind: 'program', id: 'program-1', organizationId: 'org-1' },
    });
    await port.execute({
      relationId: 'project.initiative',
      effect: 'link',
      subjects: [subject],
      target: { kind: 'initiative', id: 'initiative-1', organizationId: 'org-1' },
    });
    await expect(
      port.execute({
        relationId: 'project.label',
        effect: 'link',
        subjects: [subject],
        target: { kind: 'label', id: 'label-1', organizationId: 'org-1' },
      }),
    ).resolves.toEqual({ status: 'unchanged' });
    await port.execute({
      relationId: 'project.blocks',
      effect: 'link',
      subjects: [subject],
      target: { kind: 'project', id: 'project-2', organizationId: 'org-1' },
    });

    expect(dependencies.patchProject).toHaveBeenCalledWith('org-1', 'project-1', {
      programId: 'program-1',
    });
    expect(dependencies.linkInitiative).toHaveBeenCalledWith('org-1', 'project-1', 'initiative-1');
    expect(dependencies.addLabel).toHaveBeenCalledWith('org-1', 'project-1', 'label-1');
    expect(dependencies.addDependency).toHaveBeenCalledWith('org-1', 'project-1', 'project-2');
  });
});

describe('Program relation command port', () => {
  it('maps owner, Initiative, and Label relations without endpoint knowledge', async () => {
    const dependencies = {
      setOwner: vi.fn(async () => undefined),
      linkInitiative: vi.fn(async () => 'applied' as const),
      addLabel: vi.fn(async () => 'applied' as const),
    };
    const port = createProgramRelationCommandPort(dependencies);
    const subject = { kind: 'program' as const, id: 'program-1', organizationId: 'org-1' };

    await port.execute({
      relationId: 'program.owner',
      effect: 'move',
      subjects: [subject],
      target: { kind: 'actor', id: 'actor-1', organizationId: 'org-1' },
    });
    await port.execute({
      relationId: 'program.initiative',
      effect: 'link',
      subjects: [subject],
      target: { kind: 'initiative', id: 'initiative-1', organizationId: 'org-1' },
    });
    await port.execute({
      relationId: 'program.label',
      effect: 'link',
      subjects: [subject],
      target: { kind: 'label', id: 'label-1', organizationId: 'org-1' },
    });

    expect(dependencies.setOwner).toHaveBeenCalledWith('org-1', 'program-1', 'actor-1');
    expect(dependencies.linkInitiative).toHaveBeenCalledWith('org-1', 'program-1', 'initiative-1');
    expect(dependencies.addLabel).toHaveBeenCalledWith('org-1', 'program-1', 'label-1');
  });
});
