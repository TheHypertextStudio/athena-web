/**
 * `toPersonalActivityOut` — the owner-safe activity projection.
 *
 * @remarks
 * Pure function, no database: every activity `type`/`body` shape it redacts and bounds is
 * exercised directly, rather than indirectly through whichever route happens to touch it.
 */
import { describe, expect, it } from 'vitest';

import { toPersonalActivityOut } from '../../src/routes/me-athena-activity';
import type { ActivityRow } from '../../src/routes/agent-session-helpers';

function row(overrides: Partial<ActivityRow> & Pick<ActivityRow, 'type' | 'body'>): ActivityRow {
  return {
    id: 'activity-fixture',
    sessionId: 'session-fixture',
    organizationId: null,
    approvalStatus: null,
    proposalGroupId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('toPersonalActivityOut', () => {
  it('maps an error activity to the fixed failure copy', () => {
    const out = toPersonalActivityOut(row({ type: 'error', body: {} }));
    expect(out.body).toEqual({ text: 'Athena could not complete this step.' });
  });

  it('falls back to a generic line when a response has no text, and omits a non-user author', () => {
    const out = toPersonalActivityOut(row({ type: 'response', body: { text: '   ' } }));
    expect(out.body).toEqual({ text: 'Athena updated this work.' });
  });

  it('keeps the author flag only when the response author is the user', () => {
    const out = toPersonalActivityOut(
      row({ type: 'response', body: { text: 'Done', author: 'user' } }),
    );
    expect(out.body).toEqual({ text: 'Done', author: 'user' });
  });

  it('drops elicitation options entirely when the field is missing or not an array', () => {
    const out = toPersonalActivityOut(row({ type: 'elicitation', body: {} }));
    expect(out.body).toEqual({ text: 'Athena needs your answer.' });
  });

  it('keeps only well-formed elicitation options and drops incomplete ones', () => {
    const out = toPersonalActivityOut(
      row({
        type: 'elicitation',
        body: {
          text: 'Pick one',
          options: [
            { id: 'a', label: 'Option A' },
            { id: 'b' }, // no label — dropped
            { label: 'No id' }, // no id — dropped
            'not-an-object', // not a record — dropped
          ],
        },
      }),
    );
    expect(out.body).toEqual({
      text: 'Pick one',
      options: [{ id: 'a', label: 'Option A' }],
    });
  });

  it('omits the options field entirely when every option was dropped', () => {
    const out = toPersonalActivityOut(
      row({ type: 'elicitation', body: { text: 'Pick one', options: [{ id: 'a' }] } }),
    );
    expect(out.body).toEqual({ text: 'Pick one' });
  });

  it('returns an empty action when the body carries no action payload', () => {
    const out = toPersonalActivityOut(row({ type: 'action', body: {} }));
    expect(out.body).toEqual({
      action: { summary: 'Update your work' },
    });
  });

  it('redacts secret-shaped values and truncates deep/oversized technical input', () => {
    const out = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: 42 as unknown as string, // non-string kind is dropped, not stringified
            summary: 'Sync the calendar',
            toolCall: {
              connection: 7 as unknown as string, // non-string, dropped
              tool: 'calendar.sync',
              toolUseId: 'tu_1',
              input: {
                apiKey: 'sk-abcdef012345',
                note: 'Bearer abc.def-ghi',
                nested: { deeper: { deepest: { tooDeep: { value: 1 } } } },
                items: [1, 2, 3],
                ok: true,
                blank: null,
                // Anything that is neither a JS primitive, array, nor plain object — a function
                // is the simplest such value — falls to the '[unsupported]' catch-all.
                weird: (() => 'unreachable') as unknown,
              },
            },
          },
        },
      }),
    );
    const body = out.body as {
      action: { kind?: string; toolCall: { connection?: string; tool: string; input: unknown } };
    };
    expect(body.action.kind).toBeUndefined();
    expect(body.action.toolCall.connection).toBeUndefined();
    expect(body.action.toolCall.tool).toBe('calendar.sync');
    expect(body.action.toolCall.input).toMatchObject({
      apiKey: '[redacted]',
      note: '[redacted]',
      nested: { deeper: { deepest: '[truncated]' } },
      items: [1, 2, 3],
      ok: true,
      blank: null,
      weird: '[unsupported]',
    });
  });

  it('reports a failed result distinctly from a completed one', () => {
    const failed = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: undefined as unknown as string,
            summary: 'Ship it',
            result: { content: 'raw', isError: true },
          },
        },
      }),
    );
    expect(failed.body).toEqual({
      action: {
        summary: 'Ship it',
        result: { content: 'This action could not be completed.', isError: true },
      },
    });

    const ok = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: undefined as unknown as string,
            summary: 'Ship it',
            result: { content: 'raw', isError: false },
          },
        },
      }),
    );
    expect(ok.body).toEqual({
      action: { summary: 'Ship it', result: { content: 'Completed: Ship it', isError: false } },
    });
  });

  it('keeps a string kind and connection, and stringifies a bigint technical value', () => {
    const out = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: 'tool_call',
            summary: 'Reconcile totals',
            toolCall: {
              connection: 'accounting',
              tool: undefined as unknown as string,
              toolUseId: 'tu_2',
              input: { count: BigInt(42) },
            },
          },
        },
      }),
    );
    const body = out.body as {
      action: { kind?: string; toolCall: { connection?: string; tool?: string; input: unknown } };
    };
    expect(body.action.kind).toBe('tool_call');
    expect(body.action.toolCall.connection).toBe('accounting');
    expect(body.action.toolCall.tool).toBeUndefined();
    expect(body.action.toolCall.input).toEqual({ count: '42' });
  });

  it('omits toolCall.input entirely when the tool was called with no input', () => {
    const out = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: undefined as unknown as string,
            summary: 'Noop',
            toolCall: {
              tool: 'noop',
              connection: undefined as unknown as string,
              toolUseId: 'tu_3',
              input: undefined,
            },
          },
        },
      }),
    );
    expect(out.body).toEqual({ action: { summary: 'Noop', toolCall: { tool: 'noop' } } });
  });

  it('replaces oversized technical input with a notice instead of the raw payload', () => {
    // Each value is capped at 512 chars on its own; only enough distinct keys survive that cap
    // to still add up past the 4KB technical-input ceiling.
    const chunk = 'x'.repeat(500);
    const input = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, chunk]));
    const out = toPersonalActivityOut(
      row({
        type: 'action',
        body: {
          action: {
            kind: undefined as unknown as string,
            summary: 'Bulk import',
            toolCall: {
              tool: 'import',
              connection: 'files',
              toolUseId: 'tu_4',
              input,
            },
          },
        },
      }),
    );
    const body = out.body as { action: { toolCall: { input: unknown } } };
    expect(body.action.toolCall.input).toEqual({
      notice: 'Technical input omitted because it was too large.',
    });
  });

  it('produces an empty body for an activity type it does not project', () => {
    const out = toPersonalActivityOut(row({ type: 'thought', body: { text: 'internal' } }));
    expect(out.body).toEqual({});
  });
});
