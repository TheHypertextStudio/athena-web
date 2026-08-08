import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TodaySession from '../../src/components/today/today-session';

const conversationProps = vi.hoisted<{ orgId?: string }>(() => ({}));

vi.mock('../../src/components/athena/athena-conversation', () => ({
  default: ({ orgId }: { orgId: string }) => {
    conversationProps.orgId = orgId;
    return <div data-testid="athena-conversation" />;
  },
}));
vi.mock('../../src/components/athena/voice-launch', () => ({
  VoiceLaunch: ({ workspaceId }: { workspaceId?: string | null }) => (
    <button type="button" data-voice-workspace={workspaceId ?? ''}>
      Talk
    </button>
  ),
}));

const ORG = '01JQ0000000000000000000000';

afterEach(cleanup);

describe('TodaySession', () => {
  it('renders the one shared conversation rather than a Today-local thread', () => {
    render(<TodaySession orgId={ORG} onClose={vi.fn()} />);
    expect(screen.getByTestId('athena-conversation')).toBeInTheDocument();
    expect(conversationProps.orgId).toBe(ORG);
  });

  it('puts Talk in the session header, because voice is a mode of this conversation', () => {
    render(<TodaySession orgId={ORG} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Talk' })).toHaveAttribute(
      'data-voice-workspace',
      ORG,
    );
  });

  it('offers a way back out to the resting page', () => {
    const onClose = vi.fn();
    render(<TodaySession orgId={ORG} onClose={onClose} />);
    screen.getByRole('button', { name: 'Close Athena' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('carries the shared transition name, so the prompt morphs into it rather than swapping', () => {
    const { container } = render(<TodaySession orgId={ORG} onClose={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.viewTransitionName).toBe('today-composer');
  });
});
