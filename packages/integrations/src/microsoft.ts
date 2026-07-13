/**
 * `@docket/integrations` — the Microsoft Outlook provider client (mail capability,
 * Microsoft Graph).
 *
 * @remarks
 * Implements the read-only base client plus `MailActionsProviderClient` against the Graph
 * API (`https://graph.microsoft.com/v1.0`). Structurally mail-capable exactly like
 * `GmailProviderClient` — no provider literals anywhere. Dormant until the Microsoft OAuth
 * credentials are configured (`/v1/config` hides unconfigured providers); every request-
 * building and response-mapping path here is pure and unit-tested against canned Graph
 * JSON, so lighting it up is env values + a smoke test. See
 * `docs/engineering/specs/mail-providers.md`.
 *
 * **Thread semantics.** Graph has no thread resource: a "thread" is the set of messages
 * sharing a `conversationId`. Listings group by conversation (latest message wins);
 * mailbox actions therefore FAN OUT over the conversation's messages (a Graph archive is
 * per-message `move`, unlike Gmail's whole-thread label delta) — idempotent because moving
 * an already-archived message is a no-op and the rule layer's action ledger suppresses
 * repeats anyway.
 *
 * **Cursor semantics.** `listThreads` uses the inbox delta query: the first call walks
 * `/me/mailFolders('inbox')/messages/delta` (following `@odata.nextLink` pages) and stores
 * the final `@odata.deltaLink` as the cursor; subsequent calls replay the `deltaLink` and
 * receive only changes. Graph expires stale delta tokens with **410 Gone**, surfaced as
 * `{kind: 'cursorExpired'}` (the caller retries once without a cursor).
 */
import type {
  ConnectorProvider,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
} from './connector';
import type {
  FetchThreadInput,
  ListThreadsInput,
  MailAction,
  MailActionInput,
  MailListPage,
  MailMessage,
  MailThread,
  MailThreadSummary,
} from './mail';
import { isConnectorError } from './connector-error';
import type { MailActionsProviderClient, ResolvedAccount } from './provider-client';
import type { ProviderHttp } from './provider-http';

/** Graph `/me` identity payload. */
interface GraphMe {
  mail?: string;
  userPrincipalName?: string;
}
/** One Graph message resource (the `$select`ed subset). */
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  webLink?: string;
  receivedDateTime?: string;
  internetMessageId?: string;
  isRead?: boolean;
  categories?: string[];
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  internetMessageHeaders?: { name?: string; value?: string }[];
  /** Present on delta responses for removed items; such entries are skipped. */
  '@removed'?: unknown;
}
/** A Graph collection page envelope. */
interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/** The `$select` fields every message listing requests. */
const MESSAGE_SELECT =
  '$select=id,conversationId,subject,bodyPreview,webLink,receivedDateTime,internetMessageId,from,isRead,categories';

/** Bound on pages walked per listing call (a delta replay is normally one page). */
const MAX_DELTA_PAGES = 10;

/** Render a Graph address as RFC 5322 display form (`Name <addr>`). */
function displayAddress(a: { name?: string; address?: string } | undefined): string {
  if (!a) return '';
  if (a.name && a.address) return `${a.name} <${a.address}>`;
  return a.address ?? a.name ?? '';
}

/** Strip the API base from an absolute Graph link so it can be replayed through the client. */
function relativizeGraphLink(link: string): string {
  const marker = '/v1.0';
  const idx = link.indexOf(marker);
  return idx >= 0 ? link.slice(idx + marker.length) : link;
}

/**
 * The Microsoft Outlook connector client (Graph REST, OAuth bearer).
 */
export class MicrosoftProviderClient implements MailActionsProviderClient {
  /** @param http - The provider HTTP wrapper bound to the Graph API base. */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const me = await this.http.getJson<GraphMe>('/me');
    const label = me.mail ?? me.userPrincipalName;
    return label !== undefined ? { label } : undefined;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.importWork}
   *
   * @remarks
   * The generic import surface: recent messages as `message` items. The email-to-task
   * ingest uses {@link MicrosoftProviderClient.listThreads} instead.
   */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const page = await this.http.getJson<GraphPage<GraphMessage>>(
      `/me/messages?${MESSAGE_SELECT}&$top=100`,
    );
    return (page.value ?? []).map((m) => ({
      id: m.id,
      kind: 'message' as const,
      title: m.subject ?? (m.bodyPreview ? m.bodyPreview.slice(0, 80) : `Message ${m.id}`),
      provenance: {
        provider: 'outlook',
        externalId: m.id,
        ...(m.webLink ? { externalUrl: m.webLink } : {}),
        importedAt,
      },
    }));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: 'outlook' as ConnectorProvider },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /**
   * {@inheritDoc ConnectorProviderClient.resolveExternalUrl}
   *
   * @remarks
   * Graph deep links (`webLink`) are not derivable from an id alone; they're captured at
   * listing time instead. Returning `undefined` is the port's documented "cannot derive"
   * state — never a fabricated URL.
   */
  async resolveExternalUrl(_input: LinkResourceInput): Promise<string | undefined> {
    return undefined;
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} — mail has no container concept here. */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }

  /**
   * {@inheritDoc MailActions.listThreads}
   *
   * @remarks
   * The walk is bounded by `input.maxThreads` (mirrors Gmail's cold-pull bound), not just the
   * output list: once enough distinct conversations have been seen, the walk stops reading
   * further pages rather than draining all the way to `@odata.deltaLink` and only then
   * discarding the overflow — that would persist a cursor claiming the excess conversations
   * were consumed, and Graph's delta protocol never re-offers them once past that point. The
   * returned cursor is always real forward progress: the terminal `deltaLink` (fully drained),
   * a mid-walk `nextLink` (capped by `maxThreads` or by `MAX_DELTA_PAGES`), or — if the walk
   * made no progress at all — the page just requested, so the next sweep resumes exactly here
   * instead of silently persisting nothing and reprocessing from the original cursor forever.
   */
  async listThreads(input: ListThreadsInput): Promise<MailListPage> {
    const firstPath =
      input.cursor !== undefined
        ? relativizeGraphLink(input.cursor)
        : `/me/mailFolders('inbox')/messages/delta?${MESSAGE_SELECT}`;

    // Latest message per conversation wins (delta yields messages, not threads).
    const latestByConversation = new Map<string, GraphMessage>();
    let resumeCursor: string | undefined;
    let path = firstPath;
    try {
      for (let page = 0; page < MAX_DELTA_PAGES; page++) {
        const json = await this.http.getJson<GraphPage<GraphMessage>>(path);
        for (const m of json.value ?? []) {
          if (m['@removed'] !== undefined) continue; // deletions aren't ingest candidates
          const conversationId = m.conversationId;
          if (!conversationId) continue;
          const prior = latestByConversation.get(conversationId);
          if (!prior || (m.receivedDateTime ?? '') > (prior.receivedDateTime ?? '')) {
            latestByConversation.set(conversationId, m);
          }
        }
        if (latestByConversation.size >= input.maxThreads) {
          resumeCursor = json['@odata.deltaLink'] ?? json['@odata.nextLink'];
          break;
        }
        if (json['@odata.deltaLink']) {
          resumeCursor = json['@odata.deltaLink'];
          break;
        }
        if (!json['@odata.nextLink']) break;
        path = relativizeGraphLink(json['@odata.nextLink']);
      }
    } catch (error) {
      // Graph expires stale delta tokens with 410 Gone → the port's cursorExpired state.
      if (input.cursor !== undefined && isConnectorError(error) && error.status === 410) {
        return { kind: 'cursorExpired' };
      }
      throw error;
    }

    const threads: MailThreadSummary[] = [...latestByConversation.entries()]
      .slice(0, input.maxThreads)
      .map(([conversationId, m]) => ({
        threadId: conversationId,
        subject: m.subject ?? '',
        snippet: m.bodyPreview ?? '',
        from: displayAddress(m.from?.emailAddress),
        receivedAt: m.receivedDateTime ?? '',
        ...(m.internetMessageId !== undefined ? { rfc822MessageId: m.internetMessageId } : {}),
        externalUrl: m.webLink ?? '',
      }));

    return { kind: 'page', threads, nextCursor: resumeCursor ?? path };
  }

  /** List a conversation's message ids + categories (the thread→messages fan-out). */
  private async conversationMessages(threadId: string): Promise<GraphMessage[]> {
    const json = await this.http.getJson<GraphPage<GraphMessage>>(
      `/me/messages?$filter=conversationId eq '${threadId}'&${MESSAGE_SELECT}`,
    );
    return json.value ?? [];
  }

  /** {@inheritDoc MailActionsProviderClient.applyMailAction} */
  async applyMailAction(input: MailActionInput): Promise<void> {
    const messages = await this.conversationMessages(input.threadId);
    for (const m of messages) {
      await this.applyToMessage(m, input.action);
    }
  }

  /** Apply one {@link MailAction} to one Graph message (see the module remarks on fan-out). */
  private async applyToMessage(m: GraphMessage, action: MailAction): Promise<void> {
    switch (action.kind) {
      case 'archive':
        await this.http.postJson(`/me/messages/${m.id}/move`, { destinationId: 'archive' });
        return;
      case 'trash':
        await this.http.postJson(`/me/messages/${m.id}/move`, { destinationId: 'deleteditems' });
        return;
      case 'markRead':
        await this.http.patchJson(`/me/messages/${m.id}`, { isRead: true });
        return;
      case 'markUnread':
        await this.http.patchJson(`/me/messages/${m.id}`, { isRead: false });
        return;
      case 'applyLabel': {
        // Graph "labels" are the categories array — read-modify-write, duplicate-free.
        const categories = m.categories ?? [];
        if (!categories.includes(action.label)) {
          await this.http.patchJson(`/me/messages/${m.id}`, {
            categories: [...categories, action.label],
          });
        }
        return;
      }
      case 'removeLabel': {
        const categories = m.categories ?? [];
        if (categories.includes(action.label)) {
          await this.http.patchJson(`/me/messages/${m.id}`, {
            categories: categories.filter((c) => c !== action.label),
          });
        }
        return;
      }
    }
  }

  /** {@inheritDoc MailActionsProviderClient.fetchThread} */
  async fetchThread(input: FetchThreadInput): Promise<MailThread> {
    const json = await this.http.getJson<GraphPage<GraphMessage>>(
      `/me/messages?$filter=conversationId eq '${input.threadId}'` +
        `&$select=id,conversationId,subject,bodyPreview,webLink,receivedDateTime,internetMessageId,from,toRecipients,internetMessageHeaders`,
    );
    const raw = (json.value ?? []).slice().sort((a, b) => {
      return (a.receivedDateTime ?? '').localeCompare(b.receivedDateTime ?? '');
    });
    const messages = raw.map((m) => this.toMailMessage(m));
    return {
      threadId: input.threadId,
      subject: messages[0]?.subject ?? `Conversation ${input.threadId}`,
      messages,
      externalUrl: raw[raw.length - 1]?.webLink ?? '',
    };
  }

  /** Project one Graph message into a render-ready {@link MailMessage}. */
  private toMailMessage(m: GraphMessage): MailMessage {
    const header = (name: string): string | undefined =>
      m.internetMessageHeaders?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
    const inReplyTo = header('In-Reply-To');
    const references = (header('References') ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      id: m.id,
      from: displayAddress(m.from?.emailAddress),
      to: (m.toRecipients ?? []).map((r) => displayAddress(r.emailAddress)),
      subject: m.subject ?? '',
      snippet: m.bodyPreview ?? '',
      sentAt: m.receivedDateTime ?? '',
      ...(m.internetMessageId !== undefined ? { rfc822MessageId: m.internetMessageId } : {}),
      ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      references,
    };
  }
}
