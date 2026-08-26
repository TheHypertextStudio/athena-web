import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const discountsSummary = {
  applicationsEnabled: true,
  programs: [
    {
      key: 'student',
      name: 'Student discount',
      percentOff: 50,
      reviewMonths: 12,
      terms: 'For a verified student personal workspace.',
    },
  ],
  application: {
    id: 'application-1',
    programKey: 'student',
    status: 'needs_information',
    evidenceType: 'enrollment_document',
    institutionalEmail: 'student@unlv.edu',
    ein: null,
    informationRequest: 'Upload a current enrollment record.',
    decisionReason: null,
    submittedAt: '2026-08-20T00:00:00.000Z',
    events: [],
  },
  award: null,
  credit: null,
};

const discountsGet = vi.fn();
const evidencePost = vi.fn();
const supplementPost = vi.fn();

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          billing: {
            $get: vi.fn(),
            discounts: {
              $get: discountsGet,
              renew: { $post: vi.fn() },
              applications: {
                $post: vi.fn(),
                ':applicationId': {
                  evidence: { $post: evidencePost },
                  supplement: { $post: supplementPost },
                  withdraw: { $post: vi.fn() },
                },
              },
            },
          },
        },
      },
    },
  },
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { email: 'student@unlv.edu' } } }),
}));

const { BillingDiscountsSection } = await import('@/components/settings/billing-discounts-section');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BillingDiscountsSection', () => {
  it('uploads replacement evidence before returning the application to finance', async () => {
    discountsGet.mockResolvedValue(jsonResponse(discountsSummary));
    evidencePost.mockResolvedValue(jsonResponse(discountsSummary.application));
    supplementPost.mockResolvedValue(
      jsonResponse({ ...discountsSummary.application, status: 'submitted' }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BillingDiscountsSection orgId="org-1" isPersonal canManageBilling />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText('Finance requested: Upload a current enrollment record.'),
    ).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Response' }), {
      target: { value: 'This record covers the current semester.' },
    });
    const file = new File(['enrollment'], 'enrollment.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Replacement evidence'), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send information' }));

    await waitFor(() => {
      expect(supplementPost).toHaveBeenCalledTimes(1);
    });
    expect(evidencePost).toHaveBeenCalledWith({
      param: { orgId: 'org-1', applicationId: 'application-1' },
      form: { file },
    });
    expect(evidencePost.mock.invocationCallOrder[0]).toBeLessThan(
      supplementPost.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(supplementPost).toHaveBeenCalledWith({
      param: { orgId: 'org-1', applicationId: 'application-1' },
      json: {
        note: 'This record covers the current semester.',
        institutionalEmail: 'student@unlv.edu',
      },
    });
  });
});
