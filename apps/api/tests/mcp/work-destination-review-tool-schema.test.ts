import type { TurnInput } from '@docket/athena/turn';
import { describe, expect, it, vi } from 'vitest';

import { getContainer } from '../../src/container';
import { connect, request, reviewTurn, seedWorkspace } from './work-destination-review-harness';

describe('review_work_destination Athena contract', () => {
  it('uses a flat result schema that Vertex can use for function calling', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    let turnInput: TurnInput | undefined;
    const turn = reviewTurn({
      decision: 'deny',
      reason: 'The destination does not support the task.',
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) => {
      turnInput = input;
      return turn(input);
    });

    await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(turnInput?.tools).toEqual([
      expect.objectContaining({
        name: 'review_result',
        inputSchema: {
          type: 'object',
          properties: {
            decision: expect.objectContaining({ enum: ['grant', 'challenge', 'deny'] }),
            reason: expect.objectContaining({ type: 'string' }),
            scope: expect.objectContaining({
              type: 'object',
              properties: {
                kind: expect.objectContaining({ enum: ['origin', 'path_prefix'] }),
                value: expect.objectContaining({ type: 'string' }),
              },
              required: ['kind', 'value'],
            }),
            question: expect.objectContaining({ type: 'string' }),
          },
          required: ['decision', 'reason'],
        },
      }),
    ]);
  });
});
