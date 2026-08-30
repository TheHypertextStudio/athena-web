import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { apiQueryOptions } from '@/lib/query';

const { push, useApiQueryMock } = vi.hoisted(() => ({
  push: vi.fn(),
  useApiQueryMock: vi.fn(),
}));

vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => ({ push }) }));

vi.mock('@/lib/query', async () => {
  const actual = await vi.importActual<{ apiQueryOptions: typeof apiQueryOptions }>('@/lib/query');
  return { ...actual, apiQueryOptions: () => ({}), useApiQuery: useApiQueryMock };
});

import { RecoveryNudgeBanner } from '@/components/recovery-nudge-banner';

describe('RecoveryNudgeBanner', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('takes a user with no recovery codes to Security and can be dismissed', () => {
    useApiQueryMock.mockReturnValue({ data: { enabled: false, remaining: 0 } });
    render(<RecoveryNudgeBanner personalOrgId="org_1" userId="user_1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up recovery codes' }));
    expect(push).toHaveBeenCalledWith('/orgs/org_1/settings/security');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss recovery-code reminder' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show a banner for a healthy recovery-code set', () => {
    useApiQueryMock.mockReturnValue({ data: { enabled: true, remaining: 8 } });
    render(<RecoveryNudgeBanner personalOrgId="org_1" userId="user_1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
