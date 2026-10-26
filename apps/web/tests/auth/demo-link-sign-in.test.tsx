import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock('../../src/lib/auth-client', () => ({
  authClient: { $fetch: exchange, $store: { notify: vi.fn() } },
}));
import { DemoLinkSignIn } from '../../src/app/(auth)/sign-in/demo-link-sign-in';

const TOKEN = 'a'.repeat(43);
beforeEach(() => {
  exchange.mockReset().mockResolvedValue({ data: { status: true }, error: null });
  window.history.replaceState(
    null,
    '',
    `/sign-in?demo=openai-review#email=mcp-review%40theaicompany.org&token=${TOKEN}`,
  );
});
afterEach(cleanup);

describe('reviewer magic-link sign-in', () => {
  it('exchanges the supplied link once under Strict Mode and removes the secret from history', async () => {
    const onSignedIn = vi.fn().mockResolvedValue(undefined);
    render(
      <StrictMode>
        <DemoLinkSignIn onSignedIn={onSignedIn} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledOnce();
    });
    expect(exchange).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledWith('/sign-in/demo-link', {
      method: 'POST',
      body: {
        slug: 'openai-review',
        email: 'mcp-review@theaicompany.org',
        token: TOKEN,
      },
    });
    expect(window.location.hash).toBe('');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });
  it('requires the complete supplied link rather than accepting email alone', async () => {
    window.history.replaceState(null, '', '/sign-in?demo=openai-review');
    render(<DemoLinkSignIn onSignedIn={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Open the full link');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('uses application-owned failure copy and retries without putting the secret back in the URL', async () => {
    exchange.mockResolvedValueOnce({ error: { message: 'private provider detail' } });
    const onSignedIn = vi.fn().mockResolvedValue(undefined);
    render(<DemoLinkSignIn onSignedIn={onSignedIn} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'We could not sign you in with this link. Please try again or contact the person who supplied it.',
    );
    expect(onSignedIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledOnce();
    });
    expect(window.location.hash).toBe('');
  });
});
