import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkScheduleOut } from '@docket/work/work-schedule-management';

/** Published Event identity and native dinner schedule used by the behavioral tests. */
export function scheduleFixture() {
  const template = WorkTemplateOut.parse({
    id: '01K4AAAAAAAAAAAAAAAAAAAAA1',
    organizationId: '01K4AAAAAAAAAAAAAAAAAAAAA2',
    targetType: 'project',
    status: 'published',
    scope: 'organization',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 1,
    definition: { name: 'Event', payload: { targetType: 'project', name: 'Dinner' } },
    offeredTeamIds: [],
    latestVersion: {
      id: '01K4AAAAAAAAAAAAAAAAAAAAA3',
      workTypeId: '01K4AAAAAAAAAAAAAAAAAAAAA1',
      organizationId: '01K4AAAAAAAAAAAAAAAAAAAAA2',
      number: 1,
      definition: { name: 'Event', payload: { targetType: 'project', name: 'Dinner' } },
      publishedAt: '2026-10-01T00:00:00Z',
      publishedByActorId: null,
    },
    canEdit: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });
  const schedule = WorkScheduleOut.parse({
    id: '01K4AAAAAAAAAAAAAAAAAAAAA4',
    organizationId: template.organizationId,
    ownerProgramId: '01K4AAAAAAAAAAAAAAAAAAAAA5',
    name: 'Community dinner',
    status: 'active',
    revision: {
      id: '01K4AAAAAAAAAAAAAAAAAAAAA6',
      number: 1,
      effectiveFrom: '2026-10-01',
      document: {
        kind: 'schedule',
        revision: 1,
        template: { targetType: 'project', workTypeId: template.id, selection: { kind: 'latest' } },
        titlePattern: '{month} Dinner',
        timezone: 'America/Los_Angeles',
        root: {
          kind: 'project',
          fields: { summary: null, health: null },
          dates: {},
          placement: { programId: '01K4AAAAAAAAAAAAAAAAAAAAA5' },
        },
        stepOverrides: [],
        optionalChoices: [],
      },
      trigger: {
        kind: 'calendar',
        schedule: {
          kind: 'monthly',
          interval: 1,
          startDate: '2026-10-01',
          timezone: 'America/Los_Angeles',
          end: { kind: 'never' },
          pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
        },
      },
      createdAt: '2026-10-01T00:00:00Z',
    },
    nextRunDate: '2026-10-08',
    templateArchived: false,
    canEdit: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    pausedAt: null,
    endedAt: null,
  });
  return {
    template,
    schedule,
    orgId: template.organizationId,
    programId: '01K4AAAAAAAAAAAAAAAAAAAAA5',
  };
}
