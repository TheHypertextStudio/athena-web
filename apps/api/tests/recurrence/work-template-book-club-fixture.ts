import type { TeamId } from '@docket/identity-access/ids';
import type { LabelId } from '@docket/work/ids';
import type { ProcessDefinitionCreate } from '../../src/contracts/recurrence';

/** A representative fixed project process with hierarchy, dates, labels, and dependencies. */
export function bookClubProcess(
  teamId: TeamId,
  promotionLabelId: LabelId,
  reportingLabelId: LabelId,
  title = 'Create summary report',
): ProcessDefinitionCreate {
  return {
    name: 'Book Club Season',
    description: 'One book and its event follow-up.',
    creationMode: 'all_at_once',
    project: {
      key: 'season',
      name: 'Book Club · {date}',
      summary: 'Read and discuss one urbanism book.',
      teamId,
      status: 'planned',
      startOffsetDays: -7,
      targetOffsetDays: 45,
      labelIds: [promotionLabelId],
      timing: { kind: 'on_trigger' },
    },
    milestones: [
      {
        key: 'event',
        projectKey: 'season',
        name: 'Book club event',
        sort: 1,
        targetOffsetDays: 32,
        timing: { kind: 'relative_to_trigger', offsetDays: 30 },
      },
    ],
    tasks: [
      {
        key: 'announce',
        title: 'Announce this month’s book',
        teamId,
        projectKey: 'season',
        priority: 'medium',
        estimateMinutes: 30,
        labelIds: [promotionLabelId],
        timing: { kind: 'relative_to_trigger', offsetDays: -14 },
      },
      {
        key: 'story',
        title: 'Make story post for book club',
        teamId,
        projectKey: 'season',
        parentTaskKey: 'announce',
        state: 'todo',
        priority: 'low',
        estimate: 2,
        labelIds: [promotionLabelId],
        timing: { kind: 'on_trigger' },
      },
      {
        key: 'report',
        title,
        teamId,
        projectKey: 'season',
        milestoneKey: 'event',
        priority: 'none',
        labelIds: [reportingLabelId],
        timing: { kind: 'relative_to_trigger', offsetDays: 31 },
      },
    ],
    dependencies: [{ blockingStepKey: 'story', blockedStepKey: 'report' }],
  };
}
