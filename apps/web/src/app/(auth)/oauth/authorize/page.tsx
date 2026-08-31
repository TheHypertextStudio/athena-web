'use client';

/**
 * OAuth 2.1 consent page — the user-facing gate for MCP client authorization.
 *
 * @remarks
 * Better Auth's `oauthProvider()` plugin redirects authenticated users here when
 * an external MCP client requests scopes. The URL carries the
 * **signed authorization query** — every parameter of the original `/oauth2/authorize` request
 * plus an `exp` and a `sig` — rather than a short opaque handle:
 *
 * - `sig` — the HMAC over the query the plugin issued; its presence marks a well-formed request,
 *   and the endpoint re-verifies it server-side before honoring anything here.
 * - `client_id` — the OAuth client id (may be an HTTPS URL for CIMD clients).
 * - `scope` — space-separated list of scopes the client is requesting.
 * - `redirect_uri` — where the browser is sent once a decision is made.
 *
 * The deprecated `oidcProvider()` pair issued a `consent_code` instead; that contract is gone.
 * Nothing on this page is trusted — the query is echoed back verbatim and the server decides.
 *
 * The client's display name/icon come from `GET /v1/oauth/clients/:clientId/metadata` — the
 * **server-validated** row Better Auth's OAuth application table holds (for CIMD clients, the
 * `client_name`/`logo_uri` the server itself fetched and validated during the authorize
 * preflight; see `apps/api/src/mcp/cimd.ts`). This page never fetches the (attacker-controlled)
 * `client_id` URL directly — that would render whatever an untrusted client chose to serve.
 *
 * **Layout.** The screen composes {@link AuthLayout}: the request context (who is asking, as which
 * account, which verified domain, where the browser will be returned) fills the card's left column
 * and the permission list plus the decision buttons fill the right.
 *
 * Permissions are collapsed disclosures inside one tonal block capped at `45dvh`. That cap is the
 * fix, not decoration: the previous `max-w-sm` card put `Authorize` below an unbounded scope list
 * with no scroll container anywhere, so a five-scope request on a laptop pushed the primary action
 * off-screen. The server accepts arbitrary requested scopes, so the row count has no ceiling — only
 * bounding the list keeps the decision reachable at any viewport height.
 *
 * **Copy.** Every word describing a permission comes from `@/lib/oauth-scope-copy`, which is keyed
 * by the closed issuable set in `@docket/types` and enumerated by a test. This screen never prints
 * a raw permission identifier: the page is read by someone deciding whether to trust an app, and
 * `connectors:link` in front of that person is noise that reads as something official.
 *
 * This file lives under the `(auth)` route group — which does not change its `/oauth/authorize`
 * URL — so it inherits the layout publishing `--font-fraunces`. Outside the group the wordmark's
 * display face silently resolved to Georgia.
 *
 * On **Approve**: POSTs to `/api/auth/oauth2/consent` with `{ accept: true, oauth_query }`, where
 * `oauth_query` is this page's own query string echoed back unmodified. Better Auth verifies the
 * signature, stores the consent, mints an authorization code, and returns `{ redirect_uri }` —
 * the page then performs a client-side redirect to complete the flow.
 *
 * On **Deny**: POSTs the same endpoint with `{ accept: false, oauth_query }`. Better Auth returns
 * a `redirect_uri` pointing at the client's callback with `error=access_denied`.
 *
 * Unauthenticated users are redirected to `/sign-in` with the current search params preserved
 * so Better Auth can resume the flow after the user signs in.
 *
 * **Switching accounts.** "Not you? Switch account" under the account row deliberately signs out
 * and resumes through the same signed-out redirect, so choosing a different account lands right
 * back on this exact request instead of abandoning it.
 */
import { AuthLayout } from '@docket/ui/components';
import {
  Cable,
  ChevronDown,
  Edit,
  Link as LinkIcon,
  RefreshCw,
  Sparkles,
  TaskAlt,
  XCircle,
} from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  focusRingInset,
  Surface,
  Text,
} from '@docket/ui/primitives';
import Link from 'next/link';
// `next/navigation` directly, not `@/lib/app-location`: this page is in the `(auth)` route group,
// which mounts no `AppLocationProvider` — that provider wraps `(app)` only. Reading through the
// app-location hooks here throws at prerender. The `no-restricted-imports` rule scopes itself to
// `(app)/`, `components/`, and `lib/` for the same reason.
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type ComponentType,
  type JSX,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { signInReturnPath } from '@/components/app-shell-utils';
import Wordmark from '@/components/wordmark';
import { api } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth-client';
import { describeScope, OAUTH_SCOPE_ACCESS_LABEL } from '@/lib/oauth-scope-copy';
import { resolveSessionStatus } from '@/lib/session-status';

/**
 * The glyph for each permission Docket can grant.
 *
 * @remarks
 * Icons are presentation, so they live with the screen while the words live in
 * `@/lib/oauth-scope-copy` — which keeps that module free of React and trivially testable. Keyed
 * by the permission string rather than folded into the copy entries for the same reason.
 *
 * The fallback is deliberately a "no" glyph: a request Docket cannot satisfy should not borrow
 * the icon of a capability it does not have.
 */
const SCOPE_ICON: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  'work:read': TaskAlt,
  'work:write': Edit,
  'agents:run': Sparkles,
  'connectors:link': Cable,
  offline_access: RefreshCw,
};

/** Shown while the session read is still in flight, in place of the account address. */
const ACCOUNT_PENDING_LABEL = 'Checking your account…';

/** Safe temporary name while the server-validated OAuth client metadata is still loading. */
const UNKNOWN_CLIENT_DISPLAY_NAME = 'An app';

type ConsentError = 'expired' | 'unavailable' | 'missing-return-address';

const CONSENT_ERROR_COPY: Readonly<Record<ConsentError, { title: string; detail: string }>> = {
  expired: {
    title: 'Connection link expired',
    detail: 'Return to Codex and start the connection again. No access was granted.',
  },
  unavailable: {
    title: 'Docket could not finish the connection',
    detail: 'Check your connection, then try again.',
  },
  'missing-return-address': {
    title: 'Docket could not finish the connection',
    detail: 'Return to Codex and start the connection again. No access was granted.',
  },
};

/** Fetch the server-validated display metadata for an OAuth client. Returns `null` on any failure. */
async function fetchClientMetadata(
  clientId: string,
): Promise<{ name: string; icon: string | null } | null> {
  try {
    const res = await api.v1.oauth.clients[':clientId'].metadata.$get({ param: { clientId } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Derive a display name from server-validated client metadata without exposing an OAuth identifier. */
function clientDisplayName(metadata: { name: string } | null): string {
  if (metadata?.name) return metadata.name;
  return UNKNOWN_CLIENT_DISPLAY_NAME;
}

/** The hostname of an absolute URL, or `null` when the value is absent or unparseable. */
function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** Whether a callback host refers back to the device running the requesting client. */
function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/** Up to two initials for a display name, used as the avatar fallback (e.g. "Claude" → "C"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || '?';
}

/** The two-mark "X connects to Docket" hero: the requesting client's icon, linked to Docket's. */
function ConnectionHero({
  displayName,
  clientIcon,
}: {
  displayName: string;
  clientIcon: string | null | undefined;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Avatar className="border-outline-variant bg-surface size-8 border">
        {clientIcon ? <AvatarImage src={clientIcon} alt="" /> : null}
        <AvatarFallback className="text-body-small font-medium">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <LinkIcon className="text-on-surface-variant size-3.5" />
      <span className="bg-primary/10 text-primary font-display wonk text-body-medium flex size-8 items-center justify-center rounded-full font-semibold">
        D
      </span>
    </div>
  );
}

/**
 * One labelled row of the request context (`Your account`, `Returns to`).
 *
 * @remarks
 * `muted` is for the one row that can be waiting on a network read: the account address. It is a
 * de-emphasis, not a skeleton, because the row keeps its shape either way and a shimmering block
 * where an email will be says less than a sentence saying what is happening.
 */
function ContextRow({
  label,
  value,
  muted = false,
  action,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Optional small control under the value — e.g. "Not you? Switch account" on the account row. */
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-on-surface-variant text-label-medium">{label}</dt>
      {/* `break-words`, not `break-all`: a long address should wrap at the last point that fits,
          not slice a word in half the moment the column narrows. */}
      <dd
        className={cn(
          'text-body-medium break-words',
          muted ? 'text-on-surface-variant' : 'text-on-surface',
        )}
      >
        {value}
      </dd>
      {/* A second `<dd>` for the same `<dt>`, not a bare sibling: a `<div>` child of `<dl>` may
          only contain `<dt>`+`<dd>` groups, and HTML permits more than one `<dd>` per `<dt>`. */}
      {action ? <dd>{action}</dd> : null}
    </div>
  );
}

/**
 * One requested permission, as a disclosure row.
 *
 * @remarks
 * Rows are separated by a gap, not a `border-b` rule — Material 3 Expressive's answer for list
 * items is a gap between them rather than a divider line, because a gap reads the relationship
 * between items without drawing something that has to be justified as a boundary. Each row
 * carries its own `Surface tone="floating"`, so the gap between rows shows the card's plain
 * surface rather than a seam in one continuous block.
 *
 * The row itself takes no fixed `shape` — {@link ScopeList} sets every row's corners from the
 * list container, the same `corner-xs` seam / `corner-md` edge scheme `menuGroup()`
 * (`packages/ui/src/primitives/menu-styles.ts`) already uses for grouped rows, so the tighter
 * radius at each gap and the fuller radius only at the group's own top and bottom is automatic
 * from `:first-child`/`:last-child` rather than a per-row prop this component would have to
 * thread through. `overflow-hidden` clips the trigger's focus ring to whichever radius the row
 * actually has.
 *
 * Built on `@docket/ui/primitives`' `Collapsible` rather than native `<details>`/`<summary>` —
 * same keyboard/AT contract (Radix wires `aria-expanded` and keyboard toggling for free), but the
 * open state now reads through `data-[state=open]` like every other primitive in the system,
 * instead of a bespoke `<details>` on the auth tree the design system had nothing to reach for.
 * Collapsed by default, so a five-scope request reads as a short scannable list instead of five
 * stacked paragraphs — the label alone says what is being granted, and the detail is one click
 * away for anyone who wants it.
 *
 * Every row carries the read/write qualifier under its label, unexpanded. Whether an app is about
 * to look at your work or change it is the single most consequential fact on this screen, and
 * putting it behind a disclosure means the common case — a person who skims and approves — never
 * sees it. It sits under the label rather than beside it so a long label wraps into the row's own
 * column instead of colliding with it at 390px.
 *
 * Every permission resolves through `describeScope`, including ones Docket cannot grant, so this
 * component has no branch that can print a raw identifier.
 */
function ScopeRow({ scope }: { scope: string }): JSX.Element {
  const { label, detail, access } = describeScope(scope);
  const Icon = SCOPE_ICON[scope] ?? XCircle;
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // The browser's own find-in-page can't search a closed disclosure's content, since Radix
  // unmounts it — a person searching for text inside a collapsed permission never finds it.
  // `forceMount` keeps the region in the DOM always; `hidden="until-found"` (not the plain
  // boolean the collapsed state used before) keeps it visually collapsed while still letting
  // find-in-page match it, and the browser fires `beforematch` on a match so the row can open
  // for real instead of leaving the disclosure's own chevron/state out of sync with what's shown.
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const onBeforeMatch = (): void => {
      setOpen(true);
    };
    node.addEventListener('beforematch', onBeforeMatch);
    return () => {
      node.removeEventListener('beforematch', onBeforeMatch);
    };
  }, []);

  return (
    <Surface as="li" tone="floating" shape="none" className="overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* `items-stretch`: the glyph column, the text column, and the chevron column are all the
            row's full height, so no inline sibling is a different size than the ones beside it.

            `focusRingInset`, not the standalone `focus-visible:ring-2`. The list is a scroll
            container (`overflow-y-auto`), which clips anything drawn outside a child's box — so
            the outer ring on the first and last rows lost three of its four edges and the
            remaining one read as a divider rather than as focus, regardless of whether the rows
            themselves are flush or gapped. The design system already has an answer for dense rows
            packed against a clipping container; use it.

            `group` + `group-data-[state=open]` (not `group-open`): the chevron reads its
            ancestor's Radix `data-state`, not the CSS `:open` pseudo-class `<details>` gave for
            free. */}
        <CollapsibleTrigger
          type="button"
          className={cn(
            'group flex min-h-11 w-full items-stretch gap-3 px-3 py-2.5 text-left',
            focusRingInset,
          )}
        >
          <span
            aria-hidden="true"
            className="text-on-surface-variant flex w-5 shrink-0 items-center justify-center"
          >
            <Icon className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="text-on-surface text-body-medium font-medium break-words">
              {label}
            </span>
            <span className="text-on-surface-variant text-label-medium">
              {OAUTH_SCOPE_ACCESS_LABEL[access]}
            </span>
          </span>
          <span aria-hidden="true" className="flex w-4 shrink-0 items-center justify-center">
            <ChevronDown className="text-on-surface-variant size-4 transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent
          ref={contentRef}
          forceMount
          // Cast needed: @types/react still models `hidden` as boolean-only, one HTML-spec
          // revision behind the "until-found" value browsers already implement.
          hidden={open ? undefined : ('until-found' as unknown as true)}
        >
          {/* `ml-8` aligns the detail under the label rather than the icon (w-5 + gap-3 = 2rem). */}
          <p className="text-on-surface-variant text-body-small mr-3 mb-3 ml-8">{detail}</p>
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}

/**
 * The requested-permissions list: one scroll container of gap-separated rows, masked at
 * whichever edge currently hides more of them.
 *
 * @remarks
 * The list is capped and scrollable because the server accepts arbitrary requested scopes, so
 * the row count has no ceiling — without the cap a long list would push the decision buttons off
 * a short viewport. But a hard `max-h` + `overflow-y-auto` with no other signal is a silent trap:
 * expand every disclosure on a normal laptop and the cap cuts a row off mid-sentence, or drops it
 * entirely, with nothing in the frame suggesting more is below. The masks here are the fix — a
 * short gradient fade at whichever edge still has hidden content, recomputed on every scroll and
 * on every resize the list's own content triggers (a disclosure opening changes its height
 * without necessarily firing a scroll event). They fade to `from-surface`, the card's own plain
 * tone — what's actually behind the mask now that each row carries its own background rather than
 * the list sharing one continuous tonal block.
 *
 * Row corners come from here, not from `ScopeRow`: every row gets the MD3 `corner-xs` seam
 * radius, and `:first-child`/`:last-child` alone escalate to `corner-md` on the edge facing the
 * group's own boundary — the tighter radius at every gap is what reads as one list that has been
 * cut into rows rather than a stack of unrelated pills, the same reasoning `menuGroup()`
 * (`packages/ui/src/primitives/menu-styles.ts`) already applies to a menu's own sectioned rows.
 * Driven entirely by these selectors so a row never needs to know its own position in the list.
 */
function ScopeList({ scopes }: { scopes: readonly string[] }): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const updateEdges = (): void => {
      setEdges({
        top: list.scrollTop > 1,
        bottom: list.scrollTop + list.clientHeight < list.scrollHeight - 1,
      });
    };

    updateEdges();
    list.addEventListener('scroll', updateEdges);
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(list);
    for (const child of list.children) resizeObserver.observe(child);

    return () => {
      list.removeEventListener('scroll', updateEdges);
      resizeObserver.disconnect();
    };
  }, [scopes]);

  return (
    <div className="relative min-w-0">
      <ul
        ref={listRef}
        className="[&>li]:rounded-corner-xs [&>li:first-child]:rounded-t-corner-md [&>li:last-child]:rounded-b-corner-md flex max-h-[40dvh] flex-col gap-1 overflow-y-auto"
      >
        {scopes.map((scope) => (
          <ScopeRow key={scope} scope={scope} />
        ))}
      </ul>
      {edges.top ? (
        <div
          aria-hidden="true"
          className="from-surface pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b to-transparent"
        />
      ) : null}
      {edges.bottom ? (
        <div
          aria-hidden="true"
          className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t to-transparent"
        />
      ) : null}
    </div>
  );
}

/**
 * The "Not you? Switch account" action under the account row.
 *
 * @remarks
 * Owns its own `pending`/`failed` UI state rather than lifting it into `ConsentPage` — this is
 * the one place on the screen that cares about the "not you?" case in detail. It does report
 * whether a sign-out is in flight via `onSwitchingChange`, though: `ConsentPage`'s own decision
 * buttons must not be submittable while this screen's session is being torn down underneath them
 * (see the call site), so that one bit can't stay fully local.
 *
 * Signs out of the account shown above and resumes this exact authorization request after the
 * next sign-in — the same cold-start resume a server-ended session already relies on, just
 * reached deliberately instead of by surprise. Calls `signOut` directly rather than the app
 * shell's `signOutAndPurge`: that helper requires the offline outbox to have already bound an
 * owner, which only happens once the authenticated app boots — never true on this pre-app
 * screen, so it would throw for a real, signed-in person. The session itself still ends
 * correctly either way; only the local-only offline cache purge is skipped, and there is nothing
 * in that cache for a screen that never loaded app data.
 */
/** Props for {@link SwitchAccountControl}. */
interface SwitchAccountControlProps {
  readonly sessionSettled: boolean;
  readonly accountEmail: string | null;
  // The whole session, not a pre-extracted id: reading `.user.id` here (rather than passing
  // `session?.user.id` from the caller) keeps that optional chain's branch charged to this
  // component's own complexity budget instead of `ConsentPage`'s already-ledgered one.
  readonly session: ReturnType<typeof useSession>['data'];
  /** Reports whether a sign-out is in flight, so the decision buttons can't be submitted mid-switch. */
  readonly onSwitchingChange: (switching: boolean) => void;
}

function SwitchAccountControl({
  sessionSettled,
  accountEmail,
  session,
  onSwitchingChange,
}: SwitchAccountControlProps): JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const userId = session?.user.id;

  const onSwitch = useCallback((): void => {
    if (!userId) return;
    setPending(true);
    setFailed(false);
    onSwitchingChange(true);
    void signOut(userId).then((outcome) => {
      if (outcome === 'failed') {
        setFailed(true);
        setPending(false);
        onSwitchingChange(false);
        return;
      }
      // 'signed-out' or 'owner-changed': either way this tab's session no longer matches what it
      // just showed. A hard navigation, not `router.replace`, so no stale session-hook state from
      // this tab survives into the sign-in page's own read. Deliberately left `switching` at
      // `true` here rather than resetting it — the buttons stay disabled through the redirect
      // instead of flashing enabled again for the instant before the navigation lands.
      window.location.href = signInReturnPath(
        `${window.location.pathname}${window.location.search}`,
      );
    });
  }, [userId, onSwitchingChange]);

  if (!sessionSettled || accountEmail === null) return null;
  return (
    <>
      <button
        type="button"
        onClick={onSwitch}
        disabled={pending}
        // No separate `font-medium`: `text-label-medium` already carries weight 500 as part of
        // the token (`--text-label-medium--font-weight`), so adding it again would only be a new
        // raw-type-utility hit for no visual change.
        className="text-primary text-label-medium inline-flex min-h-10 w-fit items-center underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
      >
        {pending ? 'Signing out…' : 'Not you? Switch account'}
      </button>
      {failed ? (
        <p role="alert" className="text-error text-label-medium">
          Could not sign out. Try again.
        </p>
      ) : null}
    </>
  );
}

/** The inner consent page that reads searchParams and renders the form. */
function ConsentPage(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, isPending: sessionPending, error: sessionError } = useSession();

  // `oauthProvider()` redirects here with the SIGNED authorization query — every original
  // authorize parameter plus `exp`/`sig` — not the `consent_code` the deprecated oidcProvider()
  // pair issued. The whole query string is echoed back as `oauth_query`, which a `before` hook
  // on the consent endpoint signature-verifies to reload the pending authorization. `sig` is
  // therefore the marker of a well-formed request.
  const signature = params.get('sig');
  const clientId = params.get('client_id') ?? '';
  const scopeParam = params.get('scope') ?? '';
  const returnHost = hostOf(params.get('redirect_uri'));

  // `useMemo`, not a plain re-split on every render: `ScopeList`'s own effect depends on this
  // array by reference to know when to re-observe its rows, and a fresh array every render (e.g.
  // when `clientMeta`/`pending`/`error` change below) tore down and rebuilt its scroll listener
  // and `ResizeObserver` for no reason.
  const requestedScopes = useMemo(
    () =>
      scopeParam
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean),
    [scopeParam],
  );

  const [clientMeta, setClientMeta] = useState<{ name: string; icon: string | null } | null>(null);
  const [pending, setPending] = useState<'accept' | 'deny' | null>(null);
  const [error, setError] = useState<ConsentError | null>(null);
  // Whether a deliberate "switch account" sign-out is in flight — the decision buttons below must
  // not be submittable while it is, or a click on "Allow access" can race the sign-out and mint a
  // grant for the account the person just tried to leave.
  const [switchingAccount, setSwitchingAccount] = useState(false);

  // Fetch CIMD metadata for URL-form client IDs.
  useEffect(() => {
    if (!clientId) return;
    void fetchClientMetadata(clientId).then(setClientMeta);
  }, [clientId]);

  // Redirect unauthenticated users to sign-in, then back to this exact consent screen (params
  // and all) once they authenticate. Must go through `signInReturnPath`'s `?callbackURL=`
  // wrapper - a bare `/sign-in${currentSearch}` puts the signed authorize params on
  // `/sign-in`'s own query string, which the sign-in page never reads (it only honors
  // `callbackURL`), so it falls back to the home destination and the OAuth grant is lost.
  //
  // Gated on the shared four-way classifier rather than the `!sessionPending && !session` boolean
  // pair this used to test. That pair cannot tell "signed out" from "could not ask", so a dropped
  // connection or a 5xx on `/get-session` bounced an authenticated user out of a consent flow they
  // were in the middle of granting. Only a server-confirmed `signed-out` may redirect; `unreachable`
  // falls through to the pending treatment below, where the session read is still retrying.
  const sessionStatus = resolveSessionStatus({
    hasSession: Boolean(session),
    isPending: sessionPending,
    hasError: Boolean(sessionError),
    pendingTimedOut: false,
  });
  useEffect(() => {
    if (sessionStatus === 'signed-out') {
      router.replace(signInReturnPath(`${window.location.pathname}${window.location.search}`));
    }
  }, [sessionStatus, router]);

  const decide = useCallback(
    async (accept: boolean): Promise<void> => {
      if (!signature) {
        return;
      }
      setPending(accept ? 'accept' : 'deny');
      setError(null);
      try {
        const res = await fetch('/api/auth/oauth2/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Echo the signed query back verbatim (minus the leading `?`) — the endpoint verifies
          // the signature over the exact string it issued, so re-serializing from `params` would
          // risk reordering or re-encoding it into a signature mismatch.
          body: JSON.stringify({ accept, oauth_query: window.location.search.replace(/^\?/, '') }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          setError(res.status === 400 ? 'expired' : 'unavailable');
          return;
        }
        // The handler answers `{ redirect: true, url }` even though the plugin's own OpenAPI
        // metadata for this route documents `redirect_uri`. Prefer what it actually emits and
        // fall back to the documented name, so a future version aligning with its docs keeps
        // working — and surface a real error rather than navigating to `undefined`.
        const body = (await res.json()) as { url?: string; redirect_uri?: string };
        const destination = body.url ?? body.redirect_uri;
        if (!destination) {
          setError('missing-return-address');
          return;
        }
        window.location.href = destination;
      } catch {
        setError('unavailable');
      } finally {
        setPending(null);
      }
    },
    [signature],
  );

  // Checked before anything session-shaped: whether the link is well-formed is derived entirely
  // from the URL, so waiting on a network read to say so only delays a message that cannot change.
  if (!signature) {
    return (
      <AuthLayout
        brand={<Wordmark />}
        intro={<h1 className="text-headline-small text-on-surface font-medium">Invalid request</h1>}
      >
        <p className="text-on-surface-variant text-body-medium">
          This authorization link is missing required parameters. Start the connection again from
          the app you were trying to connect.
        </p>
        {/* The previous version of this state rendered a header and nothing else, leaving the
            person on a screen with no control of any kind. */}
        <Link
          href="/"
          className="text-primary text-body-medium inline-flex min-h-10 w-fit items-center font-medium underline-offset-4 hover:underline"
        >
          Back to Docket
        </Link>
      </AuthLayout>
    );
  }

  if (sessionStatus === 'signed-out') {
    // The useEffect redirect is running; show nothing to avoid flash.
    return (
      <AuthLayout brand={<Wordmark />} intro={null}>
        <></>
      </AuthLayout>
    );
  }

  const displayName = clientDisplayName(clientMeta);
  // Only call the domain "verified" when the server actually returned validated metadata for this
  // client id. Without it the hostname is just an attacker-supplied string we happen to be able to
  // parse, and labelling that as verified is precisely the wrong thing to do on a consent screen.
  const verifiedHost = clientMeta ? hostOf(clientId) : null;

  // Everything above this line comes from the URL. Who is asking and what they are asking for are
  // therefore knowable on the first paint, and this screen used to throw all of it away for a bare
  // "Loading…" until `/get-session` answered. `unreachable` is treated as still-pending on purpose:
  // the session read is retrying, and a consent grant is exactly the wrong thing to abandon over
  // one failed request. Only the account row and the two decision buttons wait.
  const accountEmail = session?.user.email ?? null;
  const sessionSettled = sessionStatus === 'authenticated';
  // Shared by both decision buttons below: neither may be submitted while a decision is already
  // in flight, before the session has settled, or while a switch-account sign-out is tearing this
  // tab's session down underneath them. Computed once so the condition isn't duplicated per button.
  const decisionDisabled = pending !== null || !sessionSettled || switchingAccount;
  const returnDestination =
    returnHost === null
      ? null
      : isLoopbackHost(returnHost)
        ? `${displayName} on this device`
        : returnHost;
  const errorCopy = error ? CONSENT_ERROR_COPY[error] : null;

  return (
    <AuthLayout
      brand={<Wordmark />}
      intro={
        <>
          <ConnectionHero displayName={displayName} clientIcon={clientMeta?.icon} />
          <h1 className="text-headline-small text-on-surface font-medium">
            {displayName} is requesting access to Docket
          </h1>
          <dl className="border-outline-variant mt-1 flex flex-col gap-3 border-t pt-4">
            {verifiedHost ? <ContextRow label="Verified domain" value={verifiedHost} /> : null}
            <ContextRow
              label="Your account"
              value={accountEmail ?? ACCOUNT_PENDING_LABEL}
              muted={accountEmail === null}
              action={
                <SwitchAccountControl
                  sessionSettled={sessionSettled}
                  accountEmail={accountEmail}
                  session={session}
                  onSwitchingChange={setSwitchingAccount}
                />
              }
            />
            {returnDestination ? <ContextRow label="Returns to" value={returnDestination} /> : null}
          </dl>
          {/* Lives in the intro column, not trailing after the decision buttons: the buttons are
              the last thing in the children column on purpose, so the primary action is always
              the bottom-most element rather than competing with a footnote for that position. */}
          <p className="text-on-surface-variant text-body-small">
            Revoke access any time in{' '}
            <Link
              href="/settings/connected-apps"
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              Connected apps
            </Link>
            .
          </p>
        </>
      }
    >
      {requestedScopes.length > 0 ? (
        <section aria-label="Requested permissions" className="flex min-w-0 flex-col gap-3">
          <p className="text-on-surface text-label-large">Requested access</p>
          {/* Rows share this one label rather than a heading per row: they still read as one
              request being decided, even though each is its own tonal chip. See {@link ScopeList}
              for why the list is capped, scrollable, gapped rather than divided, and masked. */}
          <ScopeList scopes={requestedScopes} />
        </section>
      ) : null}

      {errorCopy ? (
        <section
          role="alert"
          className="border-error/40 bg-error-container text-on-error-container flex gap-3 rounded-lg border p-4"
        >
          <XCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <Text as="h2" token="title-small">
              {errorCopy.title}
            </Text>
            <p className="text-body-medium">{errorCopy.detail}</p>
          </div>
        </section>
      ) : null}

      {/* Reversed so the primary lands on the right at width and first when stacked.

          `sticky bottom-0`: the decision is the one control this screen exists for, so it stays
          reachable without scrolling even when a long permission list or a wrapped context row
          pushes the rest of the column past the fold. `bg-surface` matches AuthLayout's own card
          tone exactly (`surfaceToneColor('page')`), so scrolled content disappears cleanly behind
          it rather than showing through, on the rare viewport where it's actually pinned mid-scroll
          — no border, since a static rule would show even in the ordinary case where nothing is
          scrolled and the tonal permission list already reads as its own bounded block above. The
          card has no scrolling ancestor of its own, so `bottom` resolves against the viewport
          rather than any padded ancestor — `pb-[env(safe-area-inset-bottom)]` keeps the buttons
          clear of a phone's home-indicator instead of sitting flush against it. */}
      {error !== 'expired' && error !== 'missing-return-address' ? (
        <div className="bg-surface sticky bottom-0 z-10 flex flex-col-reverse gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] @3xl:flex-row @3xl:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={decisionDisabled}
            onClick={() => {
              void decide(false);
            }}
          >
            {pending === 'deny' ? 'Returning…' : 'Deny access'}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={decisionDisabled}
            onClick={() => {
              void decide(true);
            }}
          >
            {pending === 'accept' ? 'Allowing…' : 'Allow access'}
          </Button>
        </div>
      ) : null}
    </AuthLayout>
  );
}

/**
 * The OAuth 2.1 consent page.
 *
 * @remarks
 * Wrapped in `<Suspense>` because `useSearchParams()` requires it in Next.js App Router.
 */
export default function OAuthAuthorizePage(): JSX.Element {
  return (
    <Suspense>
      <ConsentPage />
    </Suspense>
  );
}
