/**
 * Asking the caller which one they meant, and what happens when asking is impossible.
 *
 * @remarks
 * The point of these is the fallback as much as the happy path: eliciting is a shortcut, and a
 * client that cannot render a prompt must still be able to resolve names — via the error carrying
 * every candidate. A regression that turned "cannot ask" into "cannot resolve" would break every
 * non-elicitation client on the surface at once.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { Elicitor } from '../../src/mcp/elicit';
import type { askWhichOne as AskWhichOne } from '../../src/mcp/elicit';

let askWhichOne!: typeof AskWhichOne;

beforeAll(async () => {
  askWhichOne = (await import('../../src/mcp/elicit')).askWhichOne;
});

const CHOICES = [
  { id: '01A', label: 'Platform Migration' },
  { id: '01B', label: 'Platform Rebuild' },
];

/** A client that can be asked, answering with `action` and `content`. */
function elicitor(
  action: string,
  content?: Record<string, unknown>,
  capable = true,
): Elicitor & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    getClientCapabilities: () => (capable ? { elicitation: {} } : {}),
    elicitInput: (params) => {
      calls.push(params);
      return Promise.resolve({ action, ...(content ? { content } : {}) });
    },
  };
}

describe('askWhichOne', () => {
  it('returns the id behind the label the caller picked', async () => {
    const client = elicitor('accept', { choice: 'Platform Rebuild' });
    const chosen = await askWhichOne(client, 'project', 'Platform', CHOICES);
    expect(chosen).toBe('01B');

    // Labels are what a person recognizes; mapping back to the id is the server's job.
    expect(client.calls[0]).toMatchObject({
      message: '"Platform" matches more than one project. Which did you mean?',
      requestedSchema: {
        properties: { choice: { enum: ['Platform Migration', 'Platform Rebuild'] } },
      },
    });
  });

  it('treats decline and cancel as "carry on and report the ambiguity"', async () => {
    for (const action of ['decline', 'cancel']) {
      expect(await askWhichOne(elicitor(action), 'project', 'Platform', CHOICES)).toBeNull();
    }
  });

  it('does not ask a client that never said it could answer', async () => {
    const client = elicitor('accept', { choice: 'Platform Rebuild' }, false);
    expect(await askWhichOne(client, 'project', 'Platform', CHOICES)).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it('does not ask when there is no server at all', async () => {
    // The agent loop and the test harness both call tool bodies with no request around them.
    expect(await askWhichOne(null, 'project', 'Platform', CHOICES)).toBeNull();
  });

  it('does not ask when the list is too long to be a sensible prompt', async () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ id: `id${i}`, label: `Project ${i}` }));
    const client = elicitor('accept', { choice: 'Project 3' });
    expect(await askWhichOne(client, 'project', 'Project', many)).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it('survives a client that advertises the capability then fails', async () => {
    const client: Elicitor = {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: () => Promise.reject(new Error('transport gone')),
    };
    expect(await askWhichOne(client, 'project', 'Platform', CHOICES)).toBeNull();
  });

  it('ignores an answer that is not one of the offered labels', async () => {
    const client = elicitor('accept', { choice: 'Something Else' });
    expect(await askWhichOne(client, 'project', 'Platform', CHOICES)).toBeNull();
  });
});

describe('request scope', () => {
  it('reports no elicitor outside a request', async () => {
    const { currentElicitor } = await import('../../src/mcp/request-context');
    expect(currentElicitor()).toBeNull();
  });

  it('exposes the server to code called anywhere beneath it', async () => {
    const { currentElicitor, withRequestScope } = await import('../../src/mcp/request-context');
    const client = elicitor('accept');

    const seen = await withRequestScope(client, async () => {
      // Two awaits deep, which is roughly where descriptor resolution sits below a tool handler.
      await Promise.resolve();
      await Promise.resolve();
      return currentElicitor();
    });
    expect(seen).toBe(client);
    // And it does not leak past the request that established it.
    expect(currentElicitor()).toBeNull();
  });

  it('keeps concurrent requests from seeing each other’s server', async () => {
    const { currentElicitor, withRequestScope } = await import('../../src/mcp/request-context');
    const first = elicitor('accept');
    const second = elicitor('accept');

    const [a, b] = await Promise.all([
      withRequestScope(first, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentElicitor();
      }),
      withRequestScope(second, () => Promise.resolve(currentElicitor())),
    ]);
    // A module-level variable would have handed both requests whichever ran last.
    expect(a).toBe(first);
    expect(b).toBe(second);
  });
});
