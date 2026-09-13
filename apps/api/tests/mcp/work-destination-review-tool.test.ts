import type { TurnEvent } from '@docket/athena/turn';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getContainer } from '../../src/container';
import { WorkDestinationReviewMcpOut } from '../../src/contracts/work-destination-review';
import {
  asCallToolResult,
  connect,
  db,
  mixedTextReviewTurn,
  request,
  resultPayload,
  reviewTurn,
  schema,
  seedUnprivilegedPeer,
  seedWorkspace,
  terminalTextReviewTurn,
  textTurn,
  thinkingReviewTurn,
  twoReviewTurns,
  unrelatedToolReviewTurn,
} from './work-destination-review-harness';

describe('review_work_destination', () => {
  it('requires agents:run before reviewing a destination', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed, ['work:read']);

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will record three TransitCenter posting patterns in the strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect((asCallToolResult(result).content[0] as { text: string }).text).toContain('agents:run');
  });

  it('requires work:read inside the reviewer handler', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed, ['agents:run']);

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will record three TransitCenter posting patterns in the strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect((asCallToolResult(result).content[0] as { text: string }).text).toContain('work:read');
  });

  it('does not run the model for a task outside the caller workspace', async () => {
    const caller = await seedWorkspace();
    const foreign = await seedWorkspace();
    const client = await connect(caller);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: {
        ...request(
          caller,
          'I will record three TransitCenter posting patterns in the strategy document.',
        ),
        organizationId: foreign.organizationId,
        taskId: foreign.taskId,
      },
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('runs Athena for a non-guest who can read a public task without an explicit grant', async () => {
    const workspace = await seedWorkspace();
    const peer = await seedUnprivilegedPeer(workspace);
    const client = await connect(peer);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'deny',
        reason: 'The destination does not support the task.',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        peer,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).not.toBe(true);
    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
    expect(stream).toHaveBeenCalledOnce();
  });

  it('does not run Athena for a same-workspace caller without view access', async () => {
    const workspace = await seedWorkspace();
    const peer = await seedUnprivilegedPeer(workspace);
    await db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, workspace.taskId));
    const client = await connect(peer);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        peer,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('advertises decision-specific output variants that reject missing required fields', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const { tools } = await client.listTools();
    const review = tools.find((tool) => tool.name === 'review_work_destination');

    expect(review?.outputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'grant' }),
          }),
          required: expect.arrayContaining(['decision', 'reason', 'scope']),
          additionalProperties: false,
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'challenge' }),
          }),
          required: expect.arrayContaining(['decision', 'reason', 'question']),
          additionalProperties: false,
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            decision: expect.objectContaining({ const: 'deny' }),
          }),
          required: expect.arrayContaining(['decision', 'reason']),
          additionalProperties: false,
        }),
      ]),
    });
  });

  it.each([
    ['grant without scope', { decision: 'grant', reason: 'The task has a named output.' }],
    [
      'challenge without question',
      { decision: 'challenge', reason: 'The task is underspecified.' },
    ],
    [
      'deny with scope',
      {
        decision: 'deny',
        reason: 'The destination does not support the task.',
        scope: { kind: 'origin', value: 'https://www.instagram.com' },
      },
    ],
    [
      'deny with question',
      {
        decision: 'deny',
        reason: 'The destination does not support the task.',
        question: 'What will you produce?',
      },
    ],
  ])('rejects %s through the registered-compatible result schema', (_label, value) => {
    expect(WorkDestinationReviewMcpOut.safeParse(value).success).toBe(false);
  });

  it('returns a bounded grant after Athena calls the one result tool', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toEqual({
      decision: 'grant',
      reason: 'The research has a named output for this task.',
      scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
    });
  });

  it.each([
    ['an equal path', '/transitcenter', '/transitcenter', 'grant'],
    ['a trailing-slash scope above a slashless path', '/transitcenter', '/transitcenter/', 'deny'],
    ['an equal path with a trailing slash', '/transitcenter/', '/transitcenter/', 'grant'],
    ['a descendant of a trailing-slash scope', '/transitcenter/posts', '/transitcenter/', 'grant'],
    ['a parent prefix', '/transitcenter/posts/weekly', '/transitcenter', 'grant'],
    ['a root prefix', '/transitcenter/posts/weekly', '/', 'grant'],
    ['a child prefix', '/transitcenter', '/transitcenter/posts', 'deny'],
    ['a partial path segment', '/transitcenter-archive', '/transitcenter', 'deny'],
  ])(
    'handles %s for destination %s and scope %s',
    async (_case, destinationPath, scopePath, expectedDecision) => {
      const seed = await seedWorkspace();
      const client = await connect(seed);
      vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
        reviewTurn({
          decision: 'grant',
          reason: 'The research has a named output for this task.',
          scope: {
            kind: 'path_prefix',
            value: `https://www.instagram.com${scopePath}`,
          },
        }),
      );

      const result = await client.callTool({
        name: 'review_work_destination',
        arguments: {
          ...request(
            seed,
            'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
          ),
          destination: { origin: 'https://www.instagram.com', path: destinationPath },
        },
      });

      expect(resultPayload(result)).toMatchObject({ decision: expectedDecision });
    },
  );

  it.each([
    ['the requested origin', 'https://www.instagram.com', 'grant'],
    ['another origin', 'https://example.com', 'deny'],
  ])('handles %s with scope %s', async (_case, scopeOrigin, expectedDecision) => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'origin', value: scopeOrigin },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: expectedDecision });
  });

  it('rejects an unnormalized destination path before Athena runs', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: {
        ...request(
          seed,
          'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
        ),
        destination: {
          origin: 'https://www.instagram.com',
          path: '/transitcenter/../privacy',
        },
      },
    });

    expect(asCallToolResult(result).isError).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('accepts Athena thinking that accompanies the one review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      thinkingReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'grant' });
  });

  it('denies Athena text that accompanies an otherwise valid review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      mixedTextReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies another Athena tool use that accompanies a valid review result', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      unrelatedToolReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies assistant text contained only in Athena’s terminal transcript', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      terminalTextReviewTurn({
        decision: 'grant',
        reason: 'The research has a named output for this task.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('returns a targeted challenge when more task detail is needed', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'challenge',
        reason: 'The intended output is missing.',
        question: 'Which strategy document section will contain the findings?',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(seed, 'I need Instagram to research transit outreach.'),
    });

    expect(resultPayload(result)).toEqual({
      decision: 'challenge',
      reason: 'The intended output is missing.',
      question: 'Which strategy document section will contain the findings?',
    });
  });

  it('denies when Athena returns a challenge after a challenge answer', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'challenge',
        reason: 'Still need more detail.',
        question: 'What else?',
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
        'I will place them under the outreach research heading.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies malformed or text-only Athena output', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn');
    stream.mockImplementationOnce(textTurn());
    stream.mockImplementationOnce(reviewTurn({ decision: 'grant', reason: 'Missing scope.' }));

    const first = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });
    const second = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(first)).toMatchObject({ decision: 'deny' });
    expect(resultPayload(second)).toMatchObject({ decision: 'deny' });
  });

  it('denies an Athena turn that calls the result tool more than once', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(twoReviewTurns());

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'deny' });
  });

  it('denies a model turn that times out', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(async function* () {
      await new Promise<void>(() => undefined);
      yield* [] as TurnEvent[];
    });
    vi.useFakeTimers();

    const pending = client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(resultPayload(await pending)).toMatchObject({ decision: 'deny' });
  });

  it('challenges a vague Instagram request without running Athena', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    const stream = vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'Social media research.',
        scope: { kind: 'origin', value: 'https://www.instagram.com' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(seed, 'I need Instagram for social media.'),
    });

    expect(resultPayload(result)).toEqual({
      decision: 'challenge',
      reason: 'The justification does not identify task work or an output.',
      question:
        'What will you do on Instagram, what will you produce, and how will that output advance this task?',
    });
    expect(stream).not.toHaveBeenCalled();
  });

  it('allows the concrete Instagram research request to receive a bounded grant', async () => {
    const seed = await seedWorkspace();
    const client = await connect(seed);
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation(
      reviewTurn({
        decision: 'grant',
        reason: 'The task names a source, action, output, and destination for the findings.',
        scope: { kind: 'path_prefix', value: 'https://www.instagram.com/transitcenter' },
      }),
    );

    const result = await client.callTool({
      name: 'review_work_destination',
      arguments: request(
        seed,
        'I will compare TransitCenter posting cadence and record three patterns in the LVBT strategy document.',
      ),
    });

    expect(resultPayload(result)).toMatchObject({ decision: 'grant' });
  });
});
