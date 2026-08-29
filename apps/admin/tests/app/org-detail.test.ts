import { describe, expect, it, vi } from 'vitest';

import { settleComplimentaryChange } from '../../src/app/(admin)/orgs/[id]/use-org-detail';

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
});
