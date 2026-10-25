import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthenticatedIdentity } from '@/components/use-authenticated-identity';
import type { ServerSessionUser } from '@/lib/server-session';

const state = vi.hoisted(() => ({
  server: true,
  snapshot: {
    userId: 'previous',
    name: 'Previous',
    email: 'previous@example.test',
    image: null,
    savedAt: 1,
  },
  session: null as { user: { id: string } } | null,
  pending: true,
  clear: vi.fn(),
  clearSnapshot: vi.fn(),
  purge: vi.fn<() => Promise<void>>(),
  requireAuthentication: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: state.clear }) }));
vi.mock('@/lib/app-location', () => ({ useAppPathname: () => '/tasks' }));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: state.session,
      isPending: state.pending,
      error: null,
      refetch: state.refetch,
    }),
  },
}));
vi.mock('@/components/authentication-interlock', () => ({
  useAuthenticationInterlock: () => ({ requireAuthentication: state.requireAuthentication }),
}));
vi.mock('@/components/pwa/outbox', () => ({ waitForOutboxSessionTransition: () => state.purge() }));
vi.mock('@/components/pwa/purge-offline-documents', () => ({
  purgeOfflineDocuments: () => state.purge(),
}));
vi.mock('@/lib/navigation-snapshot-runtime', () => ({
  purgeAllNavigationSnapshots: () => state.purge(),
}));
vi.mock('@/lib/session-snapshot', () => ({
  readSessionSnapshot: () => (state.server ? null : state.snapshot),
  clearSessionSnapshot: () => state.clearSnapshot(),
}));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }));

const current: ServerSessionUser = {
  userId: 'current',
  name: 'Current',
  email: 'current@example.test',
  image: null,
};
let root: Root | undefined;
let container: HTMLDivElement;
function Probe({ initial }: { initial: ServerSessionUser | null }) {
  const identity = useAuthenticatedIdentity(initial);
  return (
    <main>
      {identity.identitySwitching ? 'Switching account' : (initial?.name ?? 'Loading session')}
    </main>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.server = true;
  state.session = null;
  state.pending = true;
  state.purge.mockImplementation(() => new Promise(() => undefined));
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});
async function hydrate(initial: ServerSessionUser | null): Promise<unknown[]> {
  container.innerHTML = renderToString(<Probe initial={initial} />);
  state.server = false;
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container, <Probe initial={initial} />, {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  return errors;
}
it('hydrates an unresolved server session without replacing content when a browser snapshot exists', async () => {
  const errors = await hydrate(null);
  expect(errors).toEqual([]);
  expect(state.clear).toHaveBeenCalled();
  expect(container).toHaveTextContent('Switching account');
});
it('clears the previous account before releasing a server-confirmed different account', async () => {
  let completePurge: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    completePurge = resolve;
  });
  state.purge.mockReturnValue(pending);
  const errors = await hydrate(current);
  expect(errors).toEqual([]);
  expect(state.clear).toHaveBeenCalled();
  expect(state.clearSnapshot).toHaveBeenCalled();
  expect(container).toHaveTextContent('Switching account');
  await act(async () => completePurge?.());
  expect(container).toHaveTextContent('Current');
  expect(state.requireAuthentication).not.toHaveBeenCalled();
});
