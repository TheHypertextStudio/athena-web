import type { JSX } from 'react';

import {
  type AuthScreenSearchParams,
  redirectAuthenticatedVisitor,
} from '../_lib/server-entry-guard';

import { SignUpClient } from './sign-up-client';

/**
 * `/sign-up` — the server half: bounce an already-authenticated visitor before anything renders.
 *
 * @remarks
 * Same split, and the same guard, as `/sign-in`'s: the passkey registration ceremony is irreducibly
 * client-side and lives in {@link SignUpClient}, while {@link redirectAuthenticatedVisitor} decides
 * on the server — before any markup exists — whether this person belongs on an account-creation
 * form at all.
 *
 * This route is the one the measured defect hurt most. The landing page's primary CTA pointed at
 * `/sign-up` for the first ~345ms of every load — the window before the client session read
 * settled — so a signed-in person clicking at normal speed landed here, watched the form paint at
 * ~31ms, and was only bounced to `/today` at ~484ms. The CTA now points at `/open`, and this guard
 * closes the direct-navigation half of the same hole.
 *
 * @param props - The route's `searchParams` promise.
 * @returns The account-creation screen, for anyone who should still be seeing it.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: AuthScreenSearchParams;
}): Promise<JSX.Element> {
  await redirectAuthenticatedVisitor(searchParams);
  return <SignUpClient />;
}
