import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  athenaHref,
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

describe('personal Athena query definitions', () => {
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
});
