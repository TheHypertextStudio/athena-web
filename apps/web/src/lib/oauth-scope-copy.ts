/**
 * Plain-language consent copy for every permission Docket's authorization server can grant.
 *
 * @remarks
 * The consent screen is the one place a person decides whether to trust an outside app with
 * their work, and the only vocabulary they have for that decision is what this module supplies.
 * So the copy lives here, apart from the screen that renders it, for two reasons:
 *
 * 1. It can be enumerated by a test. `apps/web/tests/auth/oauth-scope-copy.test.ts` walks
 *    `OAUTH_ISSUABLE_SCOPES` and asserts every grantable permission has a written description —
 *    the check that makes "a new permission shipped with no words for it" impossible.
 * 2. {@link OAUTH_SCOPE_COPY} is keyed by `OAuthIssuableScope`, so adding a permission to the
 *    authorization server without writing copy for it is a **compile** error, not a raw
 *    identifier rendered at someone who has no idea what it means.
 *
 * Deliberately free of React imports: icons are presentation and stay in the page.
 *
 * @see {@link file://../app/(auth)/oauth/authorize/page.tsx} for the screen this feeds.
 */
import type { OAuthIssuableScope } from '@docket/types';
import { OAUTH_ISSUABLE_SCOPES } from '@docket/types';

/**
 * What kind of reach a permission gives, as a category the screen turns into a phrase.
 *
 * @remarks
 * `'none'` is not reachable from {@link OAUTH_SCOPE_COPY} — it exists only for the
 * {@link describeScope} fallback, where the honest answer is that nothing is granted.
 */
export type OAuthScopeAccess = 'read' | 'write' | 'connection' | 'none';

/** One permission described for a person who has never heard of an authorization server. */
export interface OAuthScopeCopy {
  /** The short line naming the permission, e.g. "Read your work". */
  readonly label: string;
  /** One sentence naming the data covered, revealed when the row is expanded. */
  readonly detail: string;
  /** Whether this permission looks at things, changes things, or keeps the app connected. */
  readonly access: OAuthScopeAccess;
}

/**
 * The plain-English qualifier shown beside each permission.
 *
 * @remarks
 * The OAuth consent screen must explicitly tell the user which of their resources a third-party
 * app is requesting and what it will do with them; this label is what satisfies the "what it will
 * do with them" half of that requirement. It is a phrase rather than the bare category word
 * because "write" is not something a non-technical reader should have to interpret while deciding
 * whether to trust an app.
 */
export const OAUTH_SCOPE_ACCESS_LABEL: Readonly<Record<OAuthScopeAccess, string>> = {
  read: 'View only',
  write: 'Can make changes',
  connection: 'Ongoing access',
  none: 'Grants nothing',
};

/**
 * Every permission Docket can grant, described in plain language.
 *
 * @remarks
 * Typed against `OAuthIssuableScope` — the closed set the authorization server is configured
 * from — so this map and that set cannot fall out of step. Each `detail` is written against what
 * the permission actually unlocks (`TOOL_SCOPE` in `apps/api/src/mcp/scope.ts` and
 * `docs/engineering/specs/mcp-surface.md` §2.2/§3.2), not against what the name suggests: the
 * whole point of this screen is that the description is true.
 */
export const OAUTH_SCOPE_COPY: Readonly<Record<OAuthIssuableScope, OAuthScopeCopy>> = {
  'work:read': {
    label: 'Read your work',
    detail: 'View your tasks, projects, programs, initiatives, and cycles.',
    access: 'read',
  },
  'work:write': {
    // Names archiving as well as creating and editing. The permission covers the `archive` and
    // `undo` tools, which remove and rewrite work in bulk — a person deciding whether to trust
    // an app should not learn that from the app's behaviour afterwards.
    label: 'Create and update work',
    detail:
      'Create tasks, update and organize projects, post comments and status updates, and archive work.',
    access: 'write',
  },
  'agents:run': {
    label: 'Manage agent sessions',
    detail:
      'Start and cancel agent work sessions, and approve or reject the actions an agent proposes.',
    access: 'write',
  },
  'connectors:link': {
    label: 'Link external items',
    detail: 'Connect other tools you use and link items from them to your work.',
    access: 'write',
  },
  // Not a Docket capability — this is the standard permission that lets the app refresh its own
  // access without prompting again. Described in plain terms because the person reading this
  // screen is deciding whether to trust an app, not reading a specification.
  offline_access: {
    label: 'Stay connected',
    detail: 'Keep working on your behalf without asking you to sign in again.',
    access: 'connection',
  },
};

/**
 * Whether a permission string is one Docket can actually grant.
 *
 * @param scope - The requested permission string.
 * @returns `true` when the string is a member of `OAUTH_ISSUABLE_SCOPES`.
 */
export function isIssuableScope(scope: string): scope is OAuthIssuableScope {
  return (OAUTH_ISSUABLE_SCOPES as readonly string[]).includes(scope);
}

/**
 * What the consent screen says about one requested permission.
 *
 * @remarks
 * The application-owned fallback is a truth claim, not a hedge. `oauthProvider({ scopes })` in
 * `packages/auth` is configured from `OAUTH_ISSUABLE_SCOPES`, and that array is the
 * authorization server's hard ceiling for both `/oauth2/authorize` and the token exchange — so a
 * permission that is not in {@link OAUTH_SCOPE_COPY} genuinely cannot be granted, cannot appear
 * in a minted token, and cannot unlock anything. Telling the reader "approving will not grant
 * this" is therefore accurate rather than reassuring.
 *
 * The row is still rendered. Silently dropping a permission an app asked for would understate
 * the request, which is the opposite of what this screen is for. What must never happen is
 * echoing the raw identifier: `some:future` in front of a layperson is noise that reads as
 * something official.
 *
 * @param scope - The requested permission string, straight off the authorization request.
 * @returns The copy for a known permission, or the plain-English fallback for anything else.
 */
export function describeScope(scope: string): OAuthScopeCopy {
  if (isIssuableScope(scope)) return OAUTH_SCOPE_COPY[scope];
  return {
    label: 'A permission Docket does not offer',
    detail: 'This app asked for something Docket cannot give it. Approving will not grant this.',
    access: 'none',
  };
}
