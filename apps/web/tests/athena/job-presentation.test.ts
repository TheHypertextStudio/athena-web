import { describe, expect, it } from 'vitest';

import {
  jobsFromQueue,
  jobStateLabel,
  jobStatusLine,
  jobTone,
  mergeThreadEntries,
  type ThreadEntry,
} from '../../src/lib/athena/job-presentation';
import type {
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
  PersonalAthenaStatus,
} from '../../src/lib/athena/presentation';
import type { PersonalAthenaQueuePayload } from '../../src/lib/athena/query-defs';
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';

const summary: PersonalAthenaSessionSummary = {
  id: 'session_1',
  objective: 'Protect two hours for the launch review',
  status: 'running',
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
};

function detailWith(overrides: Partial<PersonalAthenaSessionDetail>): PersonalAthenaSessionDetail {
  return {
    ...summary,
    activities: [],
    ...overrides,
  };
}

describe('jobTone', () => {
  const cases: readonly [PersonalAthenaStatus, ReturnType<typeof jobTone>][] = [
    ['pending', 'active'],
    ['running', 'active'],
    ['awaiting_input', 'attention'],
    ['awaiting_approval', 'attention'],
    ['completed', 'done'],
    ['failed', 'stopped'],
    ['canceled', 'stopped'],
  ];

  it.each(cases)('maps %s to %s', (status, tone) => {
    expect(jobTone(status)).toBe(tone);
  });
});

describe('jobStateLabel', () => {
  const cases: readonly [PersonalAthenaStatus, string][] = [
    ['pending', 'Working'],
    ['running', 'Working'],
    ['awaiting_input', 'Needs you'],
    ['awaiting_approval', 'Needs you'],
    ['completed', 'Done'],
    ['failed', 'Stopped'],
    ['canceled', 'Stopped'],
  ];

  it.each(cases)('labels %s as %s', (status, label) => {
    expect(jobStateLabel(status)).toBe(label);
  });
});

describe('jobStatusLine', () => {
  it('leads with a pending decision title over any activity or result', () => {
    const detail = detailWith({
      decision: {
        kind: 'approval',
        id: 'decision_1',
        title: 'Approve moving the launch review',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      activities: [
        {
          id: 'activity_1',
          type: 'progress',
          createdAt: '2026-07-15T16:05:00.000Z',
          text: 'Checked the calendar',
        },
      ],
      result: { title: 'Done', summary: 'Moved the review' },
    });

    expect(jobStatusLine(detail, summary)).toBe('Approve moving the launch review');
  });

  it('shows the newest non-reasoning activity with a short detail appended', () => {
    const detail = detailWith({
      activities: [
        {
          id: 'activity_1',
          type: 'tool',
          createdAt: '2026-07-15T16:01:00.000Z',
          service: 'Sunsama',
          action: 'Protected focus time',
          outcome: 'Added 2 blocks to Thursday',
        },
      ],
    });

    expect(jobStatusLine(detail, summary)).toBe(
      'Sunsama · Protected focus time · Added 2 blocks to Thursday',
    );
  });

  it('drops a long activity detail rather than appending it', () => {
    const longOutcome = 'x'.repeat(61);
    const detail = detailWith({
      activities: [
        {
          id: 'activity_1',
          type: 'tool',
          createdAt: '2026-07-15T16:01:00.000Z',
          service: 'Sunsama',
          action: 'Protected focus time',
          outcome: longOutcome,
        },
      ],
    });

    expect(jobStatusLine(detail, summary)).toBe('Sunsama · Protected focus time');
  });

  it('picks the newest activity by timestamp, not array position', () => {
    const detail = detailWith({
      activities: [
        {
          id: 'activity_newest',
          type: 'progress',
          createdAt: '2026-07-15T16:10:00.000Z',
          text: 'Second, and newest',
        },
        {
          id: 'activity_oldest',
          type: 'progress',
          createdAt: '2026-07-15T16:00:00.000Z',
          text: 'First, and oldest',
        },
      ],
    });

    expect(jobStatusLine(detail, summary)).toBe('Progress · Second, and newest');
  });

  it('discards raw reasoning and falls through to the result summary', () => {
    const detail = detailWith({
      activities: [
        {
          id: 'reasoning_1',
          type: 'reasoning',
          createdAt: '2026-07-15T16:01:00.000Z',
          text: 'Private chain of thought',
        },
      ],
      result: { title: 'Done', summary: 'Moved the review to Thursday' },
    });

    expect(jobStatusLine(detail, summary)).toBe('Moved the review to Thursday');
  });

  it('falls back to the state label when the detail has nothing to show', () => {
    const detail = detailWith({ activities: [] });

    expect(jobStatusLine(detail, { ...summary, status: 'awaiting_approval' })).toBe('Needs you');
  });

  it('falls back to the state label when the detail has not loaded yet', () => {
    expect(jobStatusLine(null, { ...summary, status: 'completed' })).toBe('Done');
  });
});

describe('mergeThreadEntries', () => {
  const activityEarly: SessionActivityOut = {
    id: 'activity_early' as SessionActivityId,
    sessionId: 'session_1' as AgentSessionId,
    organizationId: null,
    type: 'response',
    body: { text: 'Early activity' },
    createdAt: '2026-07-15T15:00:00.000Z',
  };
  const activityLate: SessionActivityOut = {
    id: 'activity_late' as SessionActivityId,
    sessionId: 'session_1' as AgentSessionId,
    organizationId: null,
    type: 'response',
    body: { text: 'Late activity' },
    createdAt: '2026-07-15T17:00:00.000Z',
  };
  const jobMiddle: PersonalAthenaSessionSummary = {
    ...summary,
    id: 'job_middle',
    createdAt: '2026-07-15T16:00:00.000Z',
  };

  it('merges activities and jobs sorted ascending by time', () => {
    const merged = mergeThreadEntries([activityLate, activityEarly], [jobMiddle]);

    expect(merged.map(entryKey)).toEqual(['activity_early', 'job_middle', 'activity_late']);
  });

  it('orders an activity before a job at the same timestamp', () => {
    const tiedJob: PersonalAthenaSessionSummary = {
      ...summary,
      id: 'job_tied',
      createdAt: activityEarly.createdAt,
    };

    const merged = mergeThreadEntries([activityEarly], [tiedJob]);

    expect(merged.map((entry) => entry.kind)).toEqual(['activity', 'job']);
  });

  it('returns an empty list for no activities and no jobs', () => {
    expect(mergeThreadEntries([], [])).toEqual([]);
  });
});

describe('jobsFromQueue', () => {
  function queueWith(
    overrides: Partial<PersonalAthenaQueuePayload> = {},
  ): PersonalAthenaQueuePayload {
    return {
      counts: { needsYou: 0, working: 0, finished: 0 },
      currentChat: null,
      sessions: { needsYou: [], working: [], finished: [] },
      ...overrides,
    };
  }

  it('flattens all three lanes into one list', () => {
    const needsYou: PersonalAthenaSessionSummary = { ...summary, id: 'needs_1' };
    const working: PersonalAthenaSessionSummary = { ...summary, id: 'working_1' };
    const finished: PersonalAthenaSessionSummary = { ...summary, id: 'finished_1' };

    const jobs = jobsFromQueue(
      queueWith({ sessions: { needsYou: [needsYou], working: [working], finished: [finished] } }),
    );

    expect(jobs.map((job) => job.id)).toEqual(['needs_1', 'working_1', 'finished_1']);
  });

  it('drops the session named by currentChat, wherever it appears', () => {
    const chatSession: PersonalAthenaSessionSummary = { ...summary, id: 'chat_1' };
    const otherJob: PersonalAthenaSessionSummary = { ...summary, id: 'working_1' };

    const jobs = jobsFromQueue(
      queueWith({
        currentChat: chatSession,
        sessions: { needsYou: [], working: [chatSession, otherJob], finished: [] },
      }),
    );

    expect(jobs.map((job) => job.id)).toEqual(['working_1']);
  });

  it('keeps every job when there is no current chat session', () => {
    const working: PersonalAthenaSessionSummary = { ...summary, id: 'working_1' };

    const jobs = jobsFromQueue(
      queueWith({ sessions: { needsYou: [], working: [working], finished: [] } }),
    );

    expect(jobs.map((job) => job.id)).toEqual(['working_1']);
  });
});

function entryKey(entry: ThreadEntry): string {
  return entry.kind === 'job' ? entry.job.id : entry.activity.id;
}
