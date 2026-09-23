/**
 * The task composer's create body: the fields a draft sets, and the `~` title token that sets the
 * time estimate.
 */
import { describe, expect, it } from 'vitest';

import type { TaskDraft } from '@/components/tasks/create-task';
import { draftTitleEstimate, taskCreateBody } from '@/components/tasks/task-create-body';

const TEAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

const DRAFT: TaskDraft = {
  title: 'Grant report',
  description: '',
  teamOverride: null,
  state: null,
  priority: 'none',
  assigneeId: null,
  projectId: null,
  milestoneId: null,
  cycleId: null,
  startDate: null,
  dueDate: null,
  labelIds: [],
  estimate: null,
  estimateMinutes: null,
  repeat: { kind: 'none' },
};

describe('draftTitleEstimate', () => {
  it('takes the estimate from a title token and removes the token', () => {
    expect(draftTitleEstimate({ title: ' Draft the brief ~45m ', estimateMinutes: null })).toEqual({
      title: 'Draft the brief',
      estimateMinutes: 45,
    });
  });

  it('prefers a picked estimate and still removes the token', () => {
    expect(draftTitleEstimate({ title: 'Draft ~45m', estimateMinutes: 90 })).toEqual({
      title: 'Draft',
      estimateMinutes: 90,
    });
  });

  it('keeps a title that is only a token', () => {
    expect(draftTitleEstimate({ title: '~45m', estimateMinutes: null })).toEqual({
      title: '~45m',
      estimateMinutes: null,
    });
  });

  it('leaves a title without a token alone', () => {
    expect(draftTitleEstimate({ title: 'Grant report', estimateMinutes: 30 })).toEqual({
      title: 'Grant report',
      estimateMinutes: 30,
    });
  });
});

describe('taskCreateBody', () => {
  it('sends only the fields the draft sets', () => {
    expect(taskCreateBody(DRAFT, TEAM_ID)).toEqual({
      title: 'Grant report',
      teamId: TEAM_ID,
      priority: 'none',
    });
  });

  it('sends both estimates and the token-free title', () => {
    const body = taskCreateBody(
      { ...DRAFT, title: 'Grant report ~1:30', estimate: 3, description: ' Notes ' },
      TEAM_ID,
    );

    expect(body).toMatchObject({
      title: 'Grant report',
      description: 'Notes',
      estimate: 3,
      estimateMinutes: 90,
    });
  });
});
