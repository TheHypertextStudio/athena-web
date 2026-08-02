import type { JSX } from 'react';

import {
  type AuthScreenSearchParams,
  redirectAuthenticatedVisitor,
} from '../_lib/server-entry-guard';

import { SignInClient } from './sign-in-client';

/**
 * `/sign-in` — the server half: bounce an already-authenticated visitor before anything renders.
 *
 * @remarks
 * The screen is split in two on purpose. The passkey ceremony is irreducibly client-side, so it
 * lives in {@link SignInClient}; the *decision* about whether this person should be looking at a
 * sign-in screen at all is made on the server, by
 * {@link redirectAuthenticatedVisitor} — the one guard `/sign-up` also runs, so the two routes
 * cannot drift apart on which sessions are bounced or which return-paths are honoured.
 *
 * That split is the fix for a real, measured defect. When the whole route was a Client Component,
 * its redirect ran in a `useEffect` — which by construction runs after the browser has already
 * painted — so a person with a valid session opening the app from the landing page saw the complete
 * sign-in card at ~75ms and only reached `/today` at ~483ms.
 *
 * @param props - The route's `searchParams` promise.
 * @returns The sign-in screen, for anyone who should still be seeing it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: AuthScreenSearchParams;
}): Promise<JSX.Element> {
  await redirectAuthenticatedVisitor(searchParams);
  return <SignInClient />;
}
