import { describe, expect, it } from 'vitest';

import {
  countLabel,
  decisionSentence,
  jobChanges,
  jobFailureCause,
  jobsFromQueue,
  jobStatusLine,
  jobTone,
  mergeThreadEntries,
  threadJobs,
  type ThreadEntry,
} from '../../src/lib/athena/job-presentation';
import type {
  PersonalAthenaActivity,
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
  PersonalAthenaStatus,
} from '../../src/lib/athena/presentation';
import type { PersonalAthenaQueuePayload } from '../../src/lib/athena/query-defs';
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';

const summary: PersonalAthenaSessionSummary = {
  id: 'session_1',
  objective: 'Protect two hours for the launch review',
  status: 'running',
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
};

/** Four minutes after the summary's `updatedAt`. */
const NOW = new Date('2026-07-15T16:04:00.000Z');

function detailWith(overrides: Partial<PersonalAthenaSessionDetail>): PersonalAthenaSessionDetail {
  return {
    ...summary,
    activities: [],
    ...overrides,
  };
}

/** A Docket `update_task` step, applied or failed. */
function updateStep(
  id: string,
  flags: { readonly applied?: boolean; readonly failed?: boolean },
): PersonalAthenaActivity {
  return {
    id,
    type: 'tool',
    createdAt: '2026-07-15T16:01:00.000Z',
    service: 'Docket',
    action: 'update task',
    technical: { toolName: 'update_task', input: { state: 'in_progress' } },
    ...flags,
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

describe('countLabel', () => {
  it('uses the singular noun for exactly one and the plural otherwise', () => {
    expect(countLabel(1, 'step')).toBe('1 step');
    expect(countLabel(3, 'step')).toBe('3 steps');
    expect(countLabel(0, 'change')).toBe('0 changes');
  });
});

describe('jobChanges and jobFailureCause', () => {
  it('counts only applied, non-failed steps as changes', () => {
    const detail = detailWith({
      activities: [
        updateStep('applied_1', { applied: true }),
        updateStep('failed_1', { failed: true }),
        updateStep('read_1', {}),
      ],
    });

    expect(jobChanges(detail).map((change) => change.id)).toEqual(['applied_1']);
  });

  it('names what did not happen from the failed step’s own call, never its result text', () => {
    const detail = detailWith({ activities: [updateStep('failed_1', { failed: true })] });

    const cause = jobFailureCause(detail);
    expect(cause).toContain('set state to In Progress');
    expect(cause).not.toContain('could not be completed');
    expect(jobFailureCause(detailWith({ activities: [] }))).toBeNull();
  });
});

describe('jobStatusLine', () => {
  it('writes only the waiting state for a waiting job, never the decision sentence', () => {
    const detail = detailWith({
      status: 'awaiting_approval',
      decision: {
        kind: 'approval',
        id: 'decision_1',
        title: 'update task',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      activities: [updateStep('tool_1', {})],
    });

    expect(jobStatusLine(detail, summary, NOW)).not.toContain(decisionSentence(detail));
    expect(jobStatusLine(detail, summary, NOW)).toBe(
      jobStatusLine(null, { ...summary, status: 'awaiting_input' }, NOW),
    );
  });

  it('narrates a running job from its newest step, by timestamp rather than array position', () => {
    const detail = detailWith({
      activities: [
        {
          id: 'activity_newest',
          type: 'progress',
          createdAt: '2026-07-15T16:10:00.000Z',
          text: 'Drafting email 2 of 3',
        },
        {
          id: 'activity_oldest',
          type: 'progress',
          createdAt: '2026-07-15T16:00:00.000Z',
          text: 'Drafting email 1 of 3',
        },
      ],
    });

    expect(jobStatusLine(detail, summary, NOW)).toBe('Drafting email 2 of 3');
  });

  it('appends a short tool outcome and drops a long one', () => {
    const tool = (outcome: string): PersonalAthenaSessionDetail =>
      detailWith({
        activities: [
          {
            id: 'activity_1',
            type: 'tool',
            createdAt: '2026-07-15T16:01:00.000Z',
            service: 'Sunsama',
            action: 'Protected focus time',
            outcome,
          },
        ],
      });

    expect(jobStatusLine(tool('Added 2 blocks'), summary, NOW)).toContain('Added 2 blocks');
    expect(jobStatusLine(tool('x'.repeat(61)), summary, NOW)).not.toContain('x'.repeat(61));
  });

  it('says when a running job started once it has no step to narrate', () => {
    expect(jobStatusLine(detailWith({ activities: [] }), summary, NOW)).toMatch(/1 hr/);
  });

  it('counts a finished job’s changes, pluralised, with when it finished', () => {
    const one = detailWith({
      status: 'completed',
      activities: [updateStep('applied_1', { applied: true })],
    });
    const two = detailWith({
      status: 'completed',
      activities: [
        updateStep('applied_1', { applied: true }),
        updateStep('applied_2', { applied: true }),
      ],
    });

    expect(jobStatusLine(one, summary, NOW)).toMatch(/4 min.*1 change$/);
    expect(jobStatusLine(two, summary, NOW)).toMatch(/2 changes$/);
  });

  it('never reports a finished job whose only change failed as a success', () => {
    const detail = detailWith({
      status: 'completed',
      activities: [updateStep('failed_1', { failed: true })],
      result: { title: 'Work finished', summary: 'Moved the task to In Progress.' },
    });

    const line = jobStatusLine(detail, summary, NOW);
    expect(line).not.toContain('Moved the task');
    expect(line).not.toMatch(/\d+ change/);
  });

  it('names what did not happen on a stopped job', () => {
    const detail = detailWith({
      status: 'failed',
      activities: [updateStep('failed_1', { failed: true })],
    });

    expect(jobStatusLine(detail, summary, NOW)).toContain(jobFailureCause(detail) ?? '—');
  });

  it('names the step a stopped job never ran, instead of a bare outcome', () => {
    const detail = detailWith({ status: 'canceled', activities: [updateStep('pending_1', {})] });

    const line = jobStatusLine(detail, summary, NOW);
    expect(line).toContain('set state to In Progress');
    expect(line).not.toBe(jobStatusLine(detailWith({ status: 'failed' }), summary, NOW));
  });

  it('says how far a stopped job got when no step names what did not happen', () => {
    const landed = detailWith({
      status: 'failed',
      activities: [updateStep('applied_1', { applied: true })],
    });
    const empty = detailWith({ status: 'canceled', activities: [] });

    expect(jobStatusLine(landed, summary, NOW)).toMatch(/1 change$/);
    expect(jobStatusLine(empty, summary, NOW)).not.toMatch(/nothing changed/i);
    expect(jobStatusLine(empty, summary, NOW)).not.toBe(jobStatusLine(landed, summary, NOW));
  });
});

describe('decisionSentence', () => {
  it('describes the newest tool activity when it carried its raw call through', () => {
    const detail = detailWith({
      decision: {
        kind: 'approval',
        id: 'proposal_1',
        title: 'update task',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      activities: [updateStep('tool_1', {})],
    });

    expect(decisionSentence(detail)).toBe('Set state to In Progress');
  });

  it('falls back to the decision title when there is no raw tool call', () => {
    const detail = detailWith({
      decision: {
        kind: 'approval',
        id: 'proposal_1',
        title: 'Approve moving the launch review',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      activities: [
        {
          id: 'activity_1',
          type: 'progress',
          createdAt: '2026-07-15T16:01:00.000Z',
          text: 'Checked the calendar',
        },
      ],
    });

    expect(decisionSentence(detail)).toBe('Approve moving the launch review');
  });
});

describe('threadJobs', () => {
  const task = { type: 'task' as const, id: 'task_1' };
  const onTask: PersonalAthenaSessionSummary = {
    ...summary,
    id: 'on_task',
    context: { source: task },
  };
  const onWorkspace: PersonalAthenaSessionSummary = { ...summary, id: 'on_workspace' };
  const onOtherTask: PersonalAthenaSessionSummary = {
    ...summary,
    id: 'on_other_task',
    context: { source: { type: 'task', id: 'task_2' } },
  };
  const all = [onTask, onWorkspace, onOtherTask];

  it('keeps only work started from the page the person is on', () => {
    expect(threadJobs(all, task, new Set()).map((job) => job.id)).toEqual(['on_task']);
    expect(threadJobs(all, undefined, new Set()).map((job) => job.id)).toEqual(['on_workspace']);
  });

  it('keeps work started in this conversation wherever it was started from', () => {
    const ids = threadJobs(all, task, new Set(['on_other_task'])).map((job) => job.id);
    expect(ids).toEqual(['on_task', 'on_other_task']);
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
  const questionMid = {
    id: 'question_mid',
    createdAt: '2026-07-15T16:30:00.000Z',
  } as unknown as ElicitationOut;

  it('merges activities, jobs, and questions sorted ascending by time', () => {
    const merged = mergeThreadEntries([activityLate, activityEarly], [jobMiddle], [questionMid]);

    expect(merged.map(entryKey)).toEqual([
      'activity_early',
      'job_middle',
      'question_mid',
      'activity_late',
    ]);
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
});

function entryKey(entry: ThreadEntry): string {
  if (entry.kind === 'job') return entry.job.id;
  if (entry.kind === 'question') return entry.question.id;
  return entry.activity.id;
}
