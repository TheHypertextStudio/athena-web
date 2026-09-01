import { productApi } from '@/lib/api';

/**
 * Whether the operator console should offer Google Workspace sign-in.
 *
 * @remarks
 * Read from the API's public `/v1/config` rather than from a `NEXT_PUBLIC_*` mirror, for the
 * same reason the product app reads its provider list there: availability is derived from the
 * server's real configuration, so the button cannot be advertised by a console whose API has no
 * Google credentials or no Workspace groups wired up. `/v1/config` is unauthenticated by design —
 * the sign-in page reads it before anyone has a session.
 *
 * Fails closed: any error leaves the console on its passkey-only path, which always works.
 */
export async function fetchAdminGoogleSso(): Promise<boolean> {
  try {
    const response = await productApi.v1.config.$get();
    if (!response.ok) return false;
    const config = await response.json();
    return config.adminGoogleSso === true;
  } catch {
    return false;
  }
}
