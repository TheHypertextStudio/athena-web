import { describe, expect, it, vi } from 'vitest';

import { settleComplimentaryChange } from '../../src/app/(admin)/orgs/[id]/complimentary-settlement';

describe('complimentary organization access', () => {
  it('reloads authoritative state after an ambiguous transport failure', async () => {
    let providerState = 'Free';
    let visibleState = 'Free';
    const load = vi.fn(async () => {
      visibleState = providerState;
    });

    const message = await settleComplimentaryChange(
      async () => {
        providerState = 'Complimentary';
        throw new Error('connection closed after commit');
      },
      load,
      'Could not grant complimentary Docket Pro.',
    );

    expect(load).toHaveBeenCalledOnce();
    expect(visibleState).toBe('Complimentary');
    expect(message).toBe('Could not grant complimentary Docket Pro.');
    expect(message).not.toContain('connection closed');
  });

  it('reloads authoritative state after the server rejects the request', async () => {
    const providerState = 'Free';
    let visibleState = 'stale';
    const load = vi.fn(async () => {
      visibleState = providerState;
    });

    const message = await settleComplimentaryChange(
      async () => new Response(JSON.stringify({ code: 'forbidden', status: 403 }), { status: 403 }),
      load,
      'Could not grant complimentary Docket Pro.',
    );

    expect(load).toHaveBeenCalledOnce();
    expect(visibleState).toBe('Free');
    expect(message).toBe('Could not grant complimentary Docket Pro.');
  });

  it('reports no error and reloads after a confirmed success', async () => {
    let providerState = 'Free';
    let visibleState = 'Free';
    const load = vi.fn(async () => {
      visibleState = providerState;
    });

    const message = await settleComplimentaryChange(
      async () => {
        providerState = 'Complimentary';
        return new Response(null, { status: 204 });
      },
      load,
      'Could not grant complimentary Docket Pro.',
    );

    expect(message).toBeNull();
    expect(load).toHaveBeenCalledOnce();
    expect(visibleState).toBe('Complimentary');
  });
});
