import { readProblemError, toUserFacingError, type UserFacingError } from '@/lib/problem';

/**
 * Settle one complimentary-access request and always refresh the authoritative billing state.
 *
 * @remarks
 * Lives apart from the `useOrgDetail` hook that calls it so that it can be gated on its own: this
 * decides what an operator is told after a grant or revoke, and it must reload billing state on
 * every path — success, rejection, and thrown failure alike — so the screen never keeps showing a
 * plan the server did not agree to.
 *
 * @param request - The grant or revoke request.
 * @param load - Reloads organization and billing state after the request settles.
 * @param failureMessage - Application-owned copy for a rejected request.
 * @returns The structured failure, or `null` after a confirmed success. Returning the error
 * rather than a rendered string keeps its status, so a 403 can offer the sign-in recovery instead
 * of an unhelpful retry.
 */
export async function settleComplimentaryChange(
  request: () => Promise<Response>,
  load: () => Promise<void>,
  failureMessage: string,
): Promise<UserFacingError | null> {
  try {
    const response = await request();
    if (!response.ok) {
      const failure = await readProblemError(response, failureMessage);
      await load();
      return failure;
    }
    await load();
    return null;
  } catch (caught) {
    const failure = toUserFacingError(caught, failureMessage);
    await load();
    return failure;
  }
}
