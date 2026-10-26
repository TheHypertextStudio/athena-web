import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/lib/auth-client', async () => {
  const { createAuthClient } = await import('better-auth/react');
  return {
    authClient: createAuthClient({
      baseURL: 'http://localhost/api/auth',
      fetchOptions: { customFetchImpl: request },
    }),
  };
});
import { authClient } from '../../src/lib/auth-client';
import { DemoLinkSignIn } from '../../src/app/(auth)/sign-in/demo-link-sign-in';

afterEach(cleanup);

function SessionConsumer() {
  const session = authClient.useSession();
  const [opening, setOpening] = useState(false);
  return (
    <>
      <p>{session.isPending ? 'Loading session' : (session.data?.user.email ?? 'Signed out')}</p>
      <button
        onClick={() => {
          setOpening(true);
        }}
      >
        Open review
      </button>
      {opening ? <DemoLinkSignIn onSignedIn={async () => undefined} /> : null}
    </>
  );
}

it('refreshes an already-mounted session consumer after the private link exchange', async () => {
  let signedIn = false;
  request.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-in/demo-link')) signedIn = true;
    const body = signedIn
      ? {
          session: { id: 'review-session', userId: 'review-user' },
          user: { id: 'review-user', email: 'mcp-review@theaicompany.org' },
        }
      : null;
    return Response.json(body);
  });
  window.history.replaceState(
    null,
    '',
    `/sign-in?demo=openai-review#email=mcp-review%40theaicompany.org&token=${'a'.repeat(43)}`,
  );
  render(<SessionConsumer />);
  await screen.findByText('Signed out');
  fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
  expect(await screen.findByText('mcp-review@theaicompany.org')).toBeVisible();
});
