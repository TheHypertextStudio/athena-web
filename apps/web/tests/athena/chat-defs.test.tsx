import { describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { orgChatGet, personalPost } = vi.hoisted(() => ({
  orgChatGet: vi.fn(),
  personalPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: orgChatGet } } } },
      me: { athena: { chat: { messages: { $post: personalPost } } } },
    },
  },
}));

import { sendOrgChatMessage } from '../../src/lib/athena/chat-defs';

const thread = {
  id: 'chat_1',
  kind: 'chat',
  status: 'running',
  objective: 'Chat',
  startedAt: '2026-09-18T10:00:00.000Z',
  endedAt: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  activities: [],
  result: null,
};

describe('sendOrgChatMessage', () => {
  it('posts through the personal door with a wire-shaped context, then re-reads the thread', async () => {
    personalPost.mockResolvedValue(okResponse(thread));
    orgChatGet.mockResolvedValue(okResponse(thread));
    const result = await sendOrgChatMessage('01HZZZZZZZZZZZZZZZZZZZZZZZ', 'What is at risk here?', {
      workspaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
    expect(personalPost).toHaveBeenCalledWith({
      json: {
        body: 'What is at risk here?',
        context: {
          workspaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          source: { type: 'project', id: 'project_1' },
        },
      },
    });
    expect(orgChatGet).toHaveBeenCalledWith({ param: { orgId: '01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(result.id).toBe('chat_1');
  });

  it('omits context when the message has none', async () => {
    personalPost.mockResolvedValue(okResponse(thread));
    orgChatGet.mockResolvedValue(okResponse(thread));
    await sendOrgChatMessage('01HZZZZZZZZZZZZZZZZZZZZZZZ', 'Plan my afternoon');
    expect(personalPost).toHaveBeenCalledWith({ json: { body: 'Plan my afternoon' } });
  });
});
