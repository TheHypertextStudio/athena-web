import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../support/query';

const summaryGet = vi.fn();
const undoPost = vi.fn();
const navigateWithoutRouter = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          voice: {
            ':id': {
              summary: { $get: summaryGet },
              changes: { ':changeSetId': { undo: { $post: undoPost } } },
            },
          },
        },
      },
    },
  },
}));

vi.mock('@/lib/app-location', () => ({
  navigateWithoutRouter,
  useAppLocation: () => ({
    pathname: '/athena',
    params: {},
    searchParams: new URLSearchParams('session=conversation-1&call=voice-1'),
  }),
}));

const { PhoneCallSummarySheet } = await import('@/components/athena/phone-call-summary-sheet');

beforeEach(() => {
  vi.resetAllMocks();
  summaryGet.mockResolvedValue(
    okResponse({
      voiceSessionId: 'voice-1',
      conversationId: 'conversation-1',
      startedAt: '2026-08-30T18:00:00.000Z',
      endedAt: '2026-08-30T18:05:00.000Z',
      changes: [
        {
          changeSetId: 'change-1',
          summary: 'Added “Book the inspection”.',
          tool: 'create_task',
          createdAt: '2026-08-30T18:02:00.000Z',
          undoneAt: null,
          undoAvailable: true,
        },
      ],
    }),
  );
  undoPost.mockResolvedValue(okResponse({ changeSetId: 'change-1', undone: true }));
});

afterEach(cleanup);

describe('PhoneCallSummarySheet', () => {
  it('shows one direct Undo and keeps the canonical conversation in the close URL', async () => {
    render(<PhoneCallSummarySheet voiceSessionId="voice-1" />, {
      wrapper: makeQueryWrapper().wrapper,
    });

    expect(await screen.findByText('Added “Book the inspection”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(undoPost).toHaveBeenCalledWith({
        param: { id: 'voice-1', changeSetId: 'change-1' },
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'Close call summary' }));
    expect(navigateWithoutRouter).toHaveBeenCalledWith('/athena?session=conversation-1');
  });
});
