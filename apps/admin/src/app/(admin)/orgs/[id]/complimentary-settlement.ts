import { userErrorMessage, userProblemMessage } from '@/lib/problem';

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
 * @returns Application-owned error copy, or `null` after a confirmed success.
 */
export async function settleComplimentaryChange(
  request: () => Promise<Response>,
  load: () => Promise<void>,
  failureMessage: string,
): Promise<string | null> {
  try {
    const response = await request();
    if (!response.ok) {
      const message = await userProblemMessage(response, failureMessage);
      await load();
      return message;
    }
    await load();
    return null;
  } catch (caught) {
    const message = userErrorMessage(caught, failureMessage);
    await load();
    return message;
  }
}
