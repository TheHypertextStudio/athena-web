import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  athenaHref,
  personalAthenaTransport,
  personalAthenaDetailDef,
  personalAthenaQueueDef,
  type PersonalAthenaTransport,
} from '../../src/lib/athena/query-defs';
import type {
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
} from '../../src/lib/athena/presentation';
import { okResponse } from '../support/query';

const summary: PersonalAthenaSessionSummary = {
  id: 'session_1',
  objective: 'Prepare the launch review',
  status: 'running',
  queueState: 'working',
  createdAt: '2026-07-15T15:00:00.000Z',
  updatedAt: '2026-07-15T16:00:00.000Z',
};

const detail: PersonalAthenaSessionDetail = {
  ...summary,
  activities: [],
  result: null,
};

function transport(): PersonalAthenaTransport {
  return {
    queue: vi.fn().mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 1, finished: 0 },
        currentChat: summary,
        sessions: { needsYou: [], working: [summary], finished: [] },
      }),
    ),
    detail: vi.fn().mockResolvedValue(okResponse(detail)),
    message: vi.fn(),
    create: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

describe('personal Athena query definitions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the cross-workspace queue and selected detail in typed me-scoped caches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = transport();
    const queueRequest = vi.mocked(api.queue);
    const detailRequest = vi.mocked(api.detail);

    const queue = await client.fetchQuery(personalAthenaQueueDef(api));
    const selected = await client.fetchQuery(personalAthenaDetailDef('session_1', api));

    expect(queue.counts).toEqual({ needsYou: 0, working: 1, finished: 0 });
    expect(selected.objective).toBe('Prepare the launch review');
    expect(queueRequest).toHaveBeenCalledOnce();
    expect(detailRequest).toHaveBeenCalledWith('session_1');
  });

  it('preserves workspace, object context, and selection when expanding to the full experience', () => {
    expect(
      athenaHref(
        {
          workspaceId: 'workspace_1',
          source: { type: 'calendar_item', id: 'item_1', label: 'Launch review' },
        },
        'session_1',
      ),
    ).toBe(
      '/athena?workspace=workspace_1&context=calendar_item%3Aitem_1&contextLabel=Launch+review&session=session_1',
    );
  });

  it('correlates a decision with its owning session on the personal API route', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(requestUrl(input));
        return new Response(
          JSON.stringify(
            requested.length === 1
              ? { id: 'activity_1', sessionId: 'session_1' }
              : {
                  id: 'session_1',
                  kind: 'job',
                  status: 'running',
                  queueState: 'working',
                  objective: 'Prepare the launch review',
                  context: null,
                  startedAt: '2026-07-15T15:00:00.000Z',
                  endedAt: null,
                  createdAt: '2026-07-15T15:00:00.000Z',
                  activities: [],
                },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    await personalAthenaTransport.decide('session_1', 'activity_1', 'approve');

    expect(requested).toEqual([
      '/v1/me/athena/sessions/session_1/activity/activity_1/approve',
      '/v1/me/athena/sessions/session_1',
    ]);
  });

  it('keeps display-only context out of the shared invocation DTO', async () => {
    let submitted: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request
            ? input
            : new Request(new URL(requestUrl(input), 'http://localhost'), init);
        submitted = await request.clone().json();
        return new Response(
          JSON.stringify({
            id: 'session_1',
            kind: 'job',
            status: 'running',
            queueState: 'working',
            objective: 'Prepare the launch review',
            context: null,
            startedAt: '2026-07-15T15:00:00.000Z',
            endedAt: null,
            createdAt: '2026-07-15T15:00:00.000Z',
            activities: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    await personalAthenaTransport.create({
      prompt: 'Prepare the launch review',
      context: { workspaceName: 'Personal' },
    });

    expect(submitted).toEqual({ prompt: 'Prepare the launch review' });
  });
});
