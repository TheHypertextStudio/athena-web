/**
 * `eventSearchProjector` — turns a canonical event-log row into a searchable activity document.
 *
 * @remarks
 * A `preloadedProjector` accepts its row directly (no database), so every entity-kind mapping and
 * fallback here is exercised as a small, direct unit test rather than through a seeded event.
 */
import { describe, expect, it } from 'vitest';

import { eventSearchProjector } from '../../src/search/projectors/activity';

function baseRow(overrides: Partial<Parameters<typeof eventSearchProjector.project>[0]['row']>) {
  return {
    id: 'event-1',
    organizationId: 'org-1',
    sourceSystem: 'docket' as const,
    kind: 'task.updated',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    title: 'Task updated',
    ...overrides,
  };
}

describe('eventSearchProjector', () => {
  it('returns null when the loader found no preloaded row', async () => {
    const doc = await eventSearchProjector.project({ entityId: 'event-1' });
    expect(doc).toBeNull();
  });

  it('maps every known entity kind to its search subject kind', async () => {
    const cases: [string, string][] = [
      ['work_item', 'task'],
      ['project', 'project'],
      ['program', 'program'],
      ['initiative', 'initiative'],
      ['cycle', 'cycle'],
      ['calendar_event', 'calendar_event'],
      ['organization', 'organization'],
    ];
    for (const [entityKind, expectedSubjectKind] of cases) {
      const doc = await eventSearchProjector.project({
        entityId: 'event-1',
        row: baseRow({ entity: { kind: entityKind, docketEntityId: 'target-1' } }),
      });
      expect(doc?.subjectKind).toBe(expectedSubjectKind);
      expect(doc?.subjectId).toBe('target-1');
      expect(doc?.visibility).toEqual({
        mode: 'event',
        subjectKind: expectedSubjectKind,
        subjectId: 'target-1',
      });
    }
  });

  it('treats an unrecognized entity kind as having no search subject', async () => {
    const doc = await eventSearchProjector.project({
      entityId: 'event-1',
      row: baseRow({ entity: { kind: 'something_new', docketEntityId: 'target-1' } }),
    });
    expect(doc?.subjectKind).toBeNull();
    expect(doc?.subjectId).toBeNull();
    expect(doc?.visibility).toEqual({ mode: 'event' });
  });

  it('has no subject at all when the entity carries no docket id', async () => {
    const doc = await eventSearchProjector.project({
      entityId: 'event-1',
      row: baseRow({ entity: { kind: 'project' } }),
    });
    expect(doc?.subjectKind).toBeNull();
    expect(doc?.subjectId).toBeNull();
  });

  it('has no subject at all when the row has no entity', async () => {
    const doc = await eventSearchProjector.project({ entityId: 'event-1', row: baseRow({}) });
    expect(doc?.subjectKind).toBeNull();
    expect(doc?.subjectId).toBeNull();
    expect(doc?.userId).toBeNull();
    expect(doc?.externalUrl).toBeNull();
  });

  it('falls back to the entity url and to the occurred time when nothing more specific is set', async () => {
    const doc = await eventSearchProjector.project({
      entityId: 'event-1',
      row: baseRow({
        entity: { kind: 'project', docketEntityId: 'target-1', url: '/entity/target-1' },
        participants: undefined,
      }),
    });
    expect(doc?.externalUrl).toBe('/entity/target-1');
    expect(doc?.route['externalUrl']).toBe('/entity/target-1');
    expect(doc?.facet['participants']).toEqual([]);
    expect(doc?.sourceUpdatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('prefers the row’s own external url and participants over the entity’s', async () => {
    const doc = await eventSearchProjector.project({
      entityId: 'event-1',
      row: baseRow({
        externalUrl: '/events/event-1',
        entity: { kind: 'project', docketEntityId: 'target-1', url: '/entity/target-1' },
        participants: [{ id: 'user-1' }],
        userId: 'user-1',
      }),
    });
    expect(doc?.externalUrl).toBe('/events/event-1');
    expect(doc?.route['externalUrl']).toBe('/events/event-1');
    expect(doc?.facet['participants']).toEqual([{ id: 'user-1' }]);
    expect(doc?.userId).toBe('user-1');
  });

  it('prefers updatedAt over occurredAt for freshness ranking when both are present', async () => {
    const doc = await eventSearchProjector.project({
      entityId: 'event-1',
      row: baseRow({ updatedAt: new Date('2026-02-02T00:00:00.000Z') }),
    });
    expect(doc?.sourceUpdatedAt).toEqual(new Date('2026-02-02T00:00:00.000Z'));
  });
});
