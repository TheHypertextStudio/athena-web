import { describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { discoverPublicationReferences } from '../src/blueprints/publication-references';
import { publication, step, ulid } from './blueprint-fixtures';
const schedule = (id: string) => ({
  key: 'weekly',
  name: 'Weekly',
  template: { targetType: 'project', workTypeId: id, selection: { kind: 'latest' } },
  titlePattern: '{month} Dinner',
  cadence: { kind: 'daily' },
  teamRule: 'none',
  actorRule: 'unassigned',
});
describe('Program schedule publication references', () => {
  it('rejects indirect regeneration through a scheduled Project blueprint', async () => {
    const child = publication(3, 'project', [
      step('program', 'program', {
        template: { workTypeId: ulid(2), selection: { kind: 'latest' } },
      }),
    ]);
    const root = WorkTemplateDefinition.parse({
      name: 'Program',
      payload: { targetType: 'program' },
      defaultSchedules: [schedule(child.workTypeId)],
    });
    await expect(
      discoverPublicationReferences(ulid(2), root, async (_kind, reference) =>
        reference?.workTypeId === ulid(2) ? publication(2, 'program') : child,
      ),
    ).rejects.toMatchObject({ code: 'blueprint_loop' });
  });
  it('budgets each future scheduled expansion independently', async () => {
    const child = publication(
      3,
      'project',
      Array.from({ length: 499 }, (_, i) => step(`task_${i}`)),
    );
    const root = WorkTemplateDefinition.parse({
      name: 'Program',
      payload: { targetType: 'program' },
      blueprint: { steps: [step('one')], dependencies: [] },
      defaultSchedules: [schedule(child.workTypeId)],
    });
    const ids = await discoverPublicationReferences(ulid(2), root, async (kind) =>
      kind === 'project' ? child : publication(4, 'task'),
    );
    expect(ids).toEqual([ulid(2), ulid(3), ulid(4)]);
  });
  it('rejects an individual scheduled expansion above 500 rows', async () => {
    const nested = publication(4, 'task', [step('extra')]);
    const child = publication(
      3,
      'project',
      Array.from({ length: 499 }, (_, i) =>
        step(`task_${i}`, 'task', {
          template: { workTypeId: nested.workTypeId, selection: { kind: 'latest' } },
        }),
      ),
    );
    const root = WorkTemplateDefinition.parse({
      name: 'Program',
      payload: { targetType: 'program' },
      defaultSchedules: [schedule(child.workTypeId)],
    });
    await expect(
      discoverPublicationReferences(ulid(2), root, async (kind) =>
        kind === 'project' ? child : nested,
      ),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
  });
});
