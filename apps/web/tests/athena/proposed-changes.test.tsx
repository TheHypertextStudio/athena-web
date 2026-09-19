/**
 * Behavior tests for `useProposedTaskChanges`'s workspace gate.
 *
 * @remarks
 * Pins the fix for the over-fetch review finding: the personal queue is still read for every job
 * system-wide (it shares `queryKeys.athena()` with the rail's own read, so the two callers dedupe
 * onto one request), but only `needs_you` jobs whose `workspace.id` or `context.workspaceId`
 * matches the active workspace may fan out a `proposals` read.
 */
import '@testing-library/jest-dom/vitest';

import type { ProposalGroupOut, ProposalItemOut } from '@docket/athena/agent-contract';
import type { AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeProposal } from '../../src/lib/athena/describe-proposal';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import { makeQueryWrapper, okResponse } from '../support/query';

const { orgChatGet, orgProposalsGet } = vi.hoisted(() => ({
  orgChatGet: vi.fn(),
  orgProposalsGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          sessions: {
            chat: { $get: orgChatGet },
            ':id': { proposals: { $get: orgProposalsGet } },
          },
        },
      },
    },
  },
}));

import { useProposedTaskChanges } from '../../src/lib/athena/proposed-changes';

const ORG_ID = 'org_1';
const OTHER_ORG_ID = 'org_2';

/** A settled thread, so `useOrgChatThread` never opens a stream and the thread source stays disabled. */
const CHAT_THREAD = {
  id: 'chat_1',
  kind: 'chat',
  status: 'completed',
  objective: 'Chat',
  startedAt: '2026-09-18T10:00:00.000Z',
  endedAt: '2026-09-18T10:05:00.000Z',
  createdAt: '2026-09-18T10:00:00.000Z',
  activities: [],
  result: null,
};

function needsYouJob(
  overrides: Partial<PersonalAthenaSessionSummary> = {},
): PersonalAthenaSessionSummary {
  return {
    id: 'session_1',
    objective: 'Follow up with the vendor',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    workspace: { id: ORG_ID, name: 'Hypertext Studio' },
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

function queuePayload(jobs: readonly PersonalAthenaSessionSummary[]) {
  return {
    counts: { needsYou: jobs.length, working: 0, finished: 0 },
    currentChat: null,
    sessions: { needsYou: jobs, working: [], finished: [] },
  };
}

function proposalItem(overrides: Partial<ProposalItemOut> = {}): ProposalItemOut {
  return {
    activityId: 'activity_1' as SessionActivityId,
    sessionId: 'session_1' as AgentSessionId,
    proposalGroupId: 'group_1',
    tool: 'update_task',
    summary: 'move to in progress',
    input: { taskId: 'task_1', state: 'in_progress' },
    mode: 'proposal',
    ghost: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

function proposalGroup(items: readonly ProposalItemOut[]): ProposalGroupOut {
  return {
    proposalGroupId: 'group_1',
    sessionId: 'session_1' as AgentSessionId,
    items: [...items],
  };
}

function transportWith(overrides: Partial<PersonalAthenaTransport> = {}): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn().mockResolvedValue(okResponse(queuePayload([]))),
    detail: vi.fn(),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
    proposals: vi.fn().mockResolvedValue(okResponse([])),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProposedTaskChanges', () => {
  it('maps an update_task proposal on a needs_you job in this workspace to its describeProposal sentence', async () => {
    orgChatGet.mockResolvedValue(okResponse(CHAT_THREAD));
    const item = proposalItem();
    const transport = transportWith({
      queue: vi.fn().mockResolvedValue(okResponse(queuePayload([needsYouJob()]))),
      proposals: vi.fn().mockResolvedValue(okResponse([proposalGroup([item])])),
    });
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(() => useProposedTaskChanges(ORG_ID, transport), { wrapper });

    await waitFor(() => {
      expect(result.current.get('task_1')).toBe(describeProposal(item));
    });
    expect(transport.proposals).toHaveBeenCalledWith('session_1');
  });

  it('never fans out a proposals read for a needs_you job in another workspace', async () => {
    orgChatGet.mockResolvedValue(okResponse(CHAT_THREAD));
    const otherWorkspaceJob = needsYouJob({
      id: 'session_2',
      workspace: { id: OTHER_ORG_ID, name: 'Another Workspace' },
    });
    const transport = transportWith({
      queue: vi.fn().mockResolvedValue(okResponse(queuePayload([otherWorkspaceJob]))),
    });
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(() => useProposedTaskChanges(ORG_ID, transport), { wrapper });

    await waitFor(() => {
      expect(transport.queue).toHaveBeenCalled();
    });
    expect(transport.proposals).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('maps nothing for a create_task proposal, which has no existing row to attach to', async () => {
    orgChatGet.mockResolvedValue(okResponse(CHAT_THREAD));
    const createItem = proposalItem({
      activityId: 'activity_2' as SessionActivityId,
      tool: 'create_task',
      summary: 'add a follow-up task',
      input: { title: 'Follow up' },
      ghost: { title: 'Follow up', teamId: null, projectId: null, dueDate: null },
    });
    const transport = transportWith({
      queue: vi.fn().mockResolvedValue(okResponse(queuePayload([needsYouJob()]))),
      proposals: vi.fn().mockResolvedValue(okResponse([proposalGroup([createItem])])),
    });
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(() => useProposedTaskChanges(ORG_ID, transport), { wrapper });

    await waitFor(() => {
      expect(transport.proposals).toHaveBeenCalledWith('session_1');
    });
    expect(result.current.size).toBe(0);
  });
});
