/**
 * `@docket/types` — active-session DTOs (Settings → Security's device list).
 *
 * @remarks
 * A **session** is a signed-in device/browser (a passkey ceremony, or the original OAuth
 * sign-in, mints one). This is distinct from a linked **identity** (an external account) and
 * from a **passkey** (a credential that can mint a session) — a user typically has one passkey
 * per device but a session per *active login*, and can be signed in on more devices than they
 * have registered passkeys for. The session's bearer token never crosses this boundary; only the
 * opaque `id` does, which the revoke endpoint resolves server-side.
 */
import { z } from 'zod';

/** A signed-in device/browser session. */
export const SessionOut = z
  .object({
    /** The session's stable id (used to target it for revocation; never the bearer token). */
    id: z
      .string()
      .describe('The session id — an opaque handle used to revoke it, never the bearer token.'),
    /** Whether this is the session the current request is authenticated with. */
    current: z
      .boolean()
      .describe('Whether this is the session the caller is making this request with.'),
    /** The IP address the session was created from, when recorded. */
    ipAddress: z
      .string()
      .nullable()
      .describe('The IP address the session was created from, or null when not recorded.'),
    /** The User-Agent string the session was created from, when recorded. */
    userAgent: z
      .string()
      .nullable()
      .describe('The raw User-Agent header from sign-in, or null when not recorded.'),
    /** ISO-8601 timestamp the session was created (signed in). */
    createdAt: z.string().describe('ISO-8601 instant the session was created (signed in).'),
    /** ISO-8601 timestamp the session was last refreshed. */
    updatedAt: z.string().describe('ISO-8601 instant the session was last refreshed.'),
  })
  .meta({ id: 'SessionOut', description: 'A signed-in device/browser session.' });
/** Session value. */
export type SessionOut = z.infer<typeof SessionOut>;

/** The caller's active sessions, most recently active first. */
export const SessionListOut = z
  .object({
    items: z
      .array(SessionOut)
      .describe('The caller’s active sessions (every signed-in device/browser), current first.'),
  })
  .meta({ id: 'SessionListOut', description: "The caller's active sessions." });
/** Session-list value. */
export type SessionListOut = z.infer<typeof SessionListOut>;
