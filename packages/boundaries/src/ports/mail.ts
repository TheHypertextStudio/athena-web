/**
 * `@docket/boundaries/ports` — the mail capability of a {@link import('./connector').Connector}.
 *
 * @remarks
 * Provider-neutral, standards-based mailbox surface: RFC 5322 message identity
 * (`Message-ID` / `In-Reply-To` / `References`), a provider-native thread identity with
 * documented per-provider semantics, cursor-based incremental listing, mailbox mutation,
 * and on-demand thread fetch. Discovered via `Connector.asMailActor()` — capability
 * membership is declared once in {@link MAIL_CAPABLE_PROVIDERS} and enforced structurally
 * by each provider client implementing `MailActionsProviderClient` (a consistency test
 * keeps the two in lockstep). See `docs/engineering/specs/mail-providers.md`.
 *
 * **Thread identity semantics.** `threadId` is always the provider's native thread handle:
 * Gmail's `threadId`; Microsoft Graph's `conversationId`. It is only meaningful within its
 * own integration. Cross-provider identity uses {@link MailThreadSummary.rfc822MessageId}
 * — the RFC 5322 `Message-ID` (Graph: `internetMessageId`) — which is globally unique per
 * message and survives forwarding between mailboxes.
 */
import type { ConnectorProvider } from './connector';

/**
 * The providers whose connectors expose the mail capability.
 *
 * @remarks
 * The declarative manifest consumed by the mock connector's capability gate and by
 * app-layer provider selection (e.g. the email-ingest sweep). The real connectors don't
 * read it — their capability is structural (the client implements
 * `MailActionsProviderClient`) — and a boundary test asserts manifest ⇔ structure agree.
 */
export const MAIL_CAPABLE_PROVIDERS: ReadonlySet<ConnectorProvider> = new Set<ConnectorProvider>([
  'gmail',
]);

/**
 * One mailbox-state action applied to a mail thread.
 *
 * @remarks
 * A discriminated union so a `label` is carried only by the label ops — `archive` /
 * `markRead` / `markUnread` / `trash` cannot be given a stray label, and `applyLabel` /
 * `removeLabel` cannot omit one. Adapters map each variant to the provider's real verbs:
 * Gmail uses `INBOX`/`UNREAD` label deltas + the trash endpoint; Microsoft Graph maps
 * archive/trash to folder moves, read state to `isRead`, and labels to `categories`.
 */
export type MailAction =
  | { readonly kind: 'archive' }
  | { readonly kind: 'markRead' }
  | { readonly kind: 'markUnread' }
  | { readonly kind: 'trash' }
  | { readonly kind: 'applyLabel'; readonly label: string }
  | { readonly kind: 'removeLabel'; readonly label: string };

/** Input to apply one mailbox action to a thread. */
export interface MailActionInput {
  /** The connection performing the action. */
  readonly connectionId: string;
  /** The mail provider. */
  readonly provider: ConnectorProvider;
  /** The provider-native thread id to act on (see the module remarks on identity). */
  readonly threadId: string;
  /** The action to apply. */
  readonly action: MailAction;
}

/** Input to fetch a mail thread for on-demand rendering. */
export interface FetchThreadInput {
  /** The connection to read through. */
  readonly connectionId: string;
  /** The provider-native thread id. */
  readonly threadId: string;
}

/** One message within a fetched mail thread. */
export interface MailMessage {
  /** The message's external id. */
  readonly id: string;
  /** The sender (display form, e.g. `Ada <ada@x.com>`). */
  readonly from: string;
  /** Recipients. */
  readonly to: readonly string[];
  /** Subject line. */
  readonly subject: string;
  /** Short preview snippet. */
  readonly snippet: string;
  /** When the message was sent (RFC3339). */
  readonly sentAt: string;
  /** RFC 5322 `Message-ID` (angle-bracket form), when the provider surfaces it. */
  readonly rfc822MessageId?: string;
  /** RFC 5322 `In-Reply-To` — the `Message-ID` this message replies to, when present. */
  readonly inReplyTo?: string;
  /** RFC 5322 `References` chain, oldest first; empty when the message carries none. */
  readonly references: readonly string[];
  /**
   * The rendered message body, when fetched.
   *
   * @remarks
   * Read-on-demand only — the body is NEVER persisted on the attachment row (only metadata
   * + snippet are). Present after a {@link MailActions.fetchThread}; absent in stored data.
   */
  readonly bodyHtml?: string;
}

/** A fetched mail thread, for rendering an `email` attachment. */
export interface MailThread {
  /** The provider-native thread id. */
  readonly threadId: string;
  /** The thread subject. */
  readonly subject: string;
  /** The messages in the thread, oldest first. */
  readonly messages: readonly MailMessage[];
  /** Canonical URL to open the thread in the provider. */
  readonly externalUrl: string;
}

/**
 * One thread in a mailbox listing — the email-to-task ingest input.
 *
 * @remarks
 * A summary of the thread's **latest** message, carrying real RFC 5322 identity so the
 * ingest funnel sees a genuine sender (no-reply detection) and downstream dedup can match
 * the same message across providers.
 */
export interface MailThreadSummary {
  /** Provider-native thread identity (Gmail `threadId`; Graph `conversationId`). */
  readonly threadId: string;
  /** Subject of the latest message. */
  readonly subject: string;
  /** Short preview snippet of the latest message. */
  readonly snippet: string;
  /** RFC 5322 `From` of the latest message (display form). */
  readonly from: string;
  /** Receipt time of the latest message (RFC3339). */
  readonly receivedAt: string;
  /** RFC 5322 `Message-ID` of the latest message, for cross-provider dedup, when surfaced. */
  readonly rfc822MessageId?: string;
  /** Canonical open-in-provider URL for the thread. */
  readonly externalUrl: string;
}

/** Input to list mailbox threads, optionally resuming from a provider cursor. */
export interface ListThreadsInput {
  /** The connection to list through. */
  readonly connectionId: string;
  /**
   * Opaque provider cursor from a previous page's `nextCursor` (Gmail `historyId`; Graph
   * `deltaLink`). Absent = a full (cold) pull of the most recent threads.
   */
  readonly cursor?: string;
  /** Explicit bound on threads returned per call — supplied by the caller, never defaulted. */
  readonly maxThreads: number;
}

/**
 * The result of one {@link MailActions.listThreads} call.
 *
 * @remarks
 * Cursor expiry is modeled in the type, not exceptions: providers invalidate stale cursors
 * (Gmail responds 404 to a stale `historyId`; Graph responds 410 Gone to a stale delta
 * token), and the caller's documented recovery is one retry without a cursor (a full
 * re-pull). Any other provider failure still throws a `ConnectorError`.
 */
export type MailListPage =
  | {
      readonly kind: 'page';
      /** The threads in this page, most recent first. */
      readonly threads: readonly MailThreadSummary[];
      /** Cursor to resume from on the next call. */
      readonly nextCursor: string;
    }
  | { readonly kind: 'cursorExpired' };

/**
 * The mailbox capability of a mail connector: list threads incrementally, mutate mailbox
 * state, and fetch a thread on demand.
 *
 * @remarks
 * Exposed only by mail providers, discovered via `Connector.asMailActor()`; non-mail
 * connectors return `undefined` there and never implement this. Sibling to the task
 * write-back capability — mailbox actions are NOT task pushes, so mail providers join
 * mail discovery but stay out of the task write-back manifest.
 */
export interface MailActions {
  /**
   * List mailbox threads as ingest summaries, incrementally when a cursor is supplied.
   *
   * @param input - The connection, optional resume cursor, and page bound.
   * @returns a page of summaries + the next cursor, or `cursorExpired` (see {@link MailListPage}).
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  listThreads(input: ListThreadsInput): Promise<MailListPage>;
  /**
   * Apply one mailbox action to a thread.
   *
   * @param input - The connection, provider, thread, and action.
   * @throws {ConnectorError} On auth (`auth`), throttle (`rate_limit`), or provider failure.
   */
  applyMailAction(input: MailActionInput): Promise<void>;
  /**
   * Fetch a thread for rendering (the body is never persisted).
   *
   * @param input - The connection and thread id.
   * @returns the render-ready thread.
   */
  fetchThread(input: FetchThreadInput): Promise<MailThread>;
}
