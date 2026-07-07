/**
 * `@docket/integrations` — the Gmail provider client (mail capability).
 *
 * @remarks
 * Implements the read-only base client plus `MailActionsProviderClient`: incremental
 * thread listing (`listThreads`, cursored by Gmail `historyId`), mailbox mutation
 * (`applyMailAction`, mapped to label deltas + the trash endpoint), and on-demand thread
 * fetch (`fetchThread`, RFC 5322 headers included). Split out of the shared Google client
 * so mail capability is structural — the client implements the mail interface — instead
 * of a provider-literal gate. Request building and response mapping are pure and
 * unit-tested through the injected HTTP client. See
 * `docs/engineering/specs/mail-providers.md`.
 *
 * **Cursor semantics.** `listThreads` without a cursor is a cold pull: `threads.list`
 * (bounded by `maxThreads`) + one metadata `threads.get` per thread, returning the
 * mailbox's current `historyId` (from `users.getProfile`) as the next cursor. With a
 * cursor it is an incremental pull: `history.list?startHistoryId=` returns only changes
 * since that point, so unchanged mailboxes cost one request. Gmail expires old history
 * ids — a **404** on `history.list` is surfaced as `{kind: 'cursorExpired'}` (the caller
 * retries once without a cursor); every other failure throws.
 */
import type {
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
import { paginateGoogle } from './google';

/** Gmail profile identity payload (also carries the mailbox's current history id). */
interface GmailProfile {
  emailAddress?: string;
  historyId?: string;
}
/** Body for Gmail's `threads.modify` (label add/remove deltas). */
interface GmailModifyBody {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}
/** One Gmail message header (`From`, `To`, `Subject`, `Date`, `Message-ID`, …). */
interface GmailHeader {
  name: string;
  value: string;
}
/** The header-bearing part of a Gmail message (metadata format). */
interface GmailMessagePayload {
  headers?: GmailHeader[];
}
/** One Gmail message resource within a thread (metadata format). */
interface GmailMessageResource {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
}
/** A Gmail thread resource (`threads.get`). */
interface GmailThreadResource {
  id?: string;
  messages?: GmailMessageResource[];
}
/** One `threads.list` entry. */
interface GmailThreadListEntry {
  id: string;
  snippet?: string;
}
/** One `history.list` record (only the message-added shape is consumed). */
interface GmailHistoryRecord {
  messagesAdded?: { message?: { threadId?: string } }[];
}
/** The `history.list` response envelope. */
interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

/** The RFC 5322 headers requested on every metadata `threads.get`. */
const THREAD_METADATA_HEADERS =
  '&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date' +
  '&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References';

/** Canonical Gmail deep link for a thread. */
function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/#all/${threadId}`;
}

/**
 * The Gmail connector client (Gmail REST, OAuth bearer).
 *
 * @remarks
 * Mail capability is structural: this class implements {@link MailActionsProviderClient},
 * and the connector's `asMailActor()` discovers it via the interface guard — no provider
 * literals anywhere.
 */
export class GmailProviderClient implements MailActionsProviderClient {
  /**
   * @param http - The provider HTTP wrapper bound to the Gmail API base.
   */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const json = await this.http.getJson<GmailProfile>('/users/me/profile');
    return json.emailAddress !== undefined ? { label: json.emailAddress } : undefined;
  }

  /**
   * {@inheritDoc ConnectorProviderClient.importWork}
   *
   * @remarks
   * The generic task-mirror import: threads as `message` items titled by snippet. The
   * email-to-task ingest does NOT use this — it uses {@link GmailProviderClient.listThreads},
   * which carries real RFC 5322 identity.
   */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const all = await paginateGoogle<GmailThreadListEntry>(this.http, 'gmail', 'threads', {
      buildUrl: (pageToken) =>
        `/users/me/threads?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      extract: (json) => {
        const j = json as { threads?: GmailThreadListEntry[]; nextPageToken?: string };
        return { items: j.threads ?? [], nextPageToken: j.nextPageToken };
      },
    });
    return all.map((t) => ({
      id: t.id,
      kind: 'message' as const,
      title: t.snippet ? t.snippet.slice(0, 80) : `Thread ${t.id}`,
      provenance: { provider: 'gmail' as const, externalId: t.id, importedAt },
    }));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: 'gmail' },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    return gmailThreadUrl(input.externalId);
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} — Gmail has no container concept. */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }

  /** {@inheritDoc MailActions.listThreads} */
  async listThreads(input: ListThreadsInput): Promise<MailListPage> {
    if (input.cursor === undefined) return this.listThreadsCold(input.maxThreads);
    return this.listThreadsIncremental(input.cursor, input.maxThreads);
  }

  /**
   * Cold pull: the most recent `maxThreads` threads via `threads.list`, each hydrated with
   * one metadata `threads.get`; the next cursor is the mailbox's current `historyId`.
   */
  private async listThreadsCold(maxThreads: number): Promise<MailListPage> {
    const entries: GmailThreadListEntry[] = [];
    let pageToken: string | undefined;
    while (entries.length < maxThreads) {
      const pageSize = Math.min(100, maxThreads - entries.length);
      const j = await this.http.getJson<{
        threads?: GmailThreadListEntry[];
        nextPageToken?: string;
      }>(
        `/users/me/threads?maxResults=${String(pageSize)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      entries.push(...(j.threads ?? []));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    const threads = await this.hydrateSummaries(entries.slice(0, maxThreads).map((t) => t.id));
    const profile = await this.http.getJson<GmailProfile>('/users/me/profile');
    if (!profile.historyId) {
      // Without a history anchor the next sweep cannot be incremental; surface it as an
      // expired cursor so the caller keeps full-pull semantics rather than storing garbage.
      return { kind: 'page', threads, nextCursor: '' };
    }
    return { kind: 'page', threads, nextCursor: profile.historyId };
  }

  /**
   * Incremental pull: `history.list` from the stored cursor, yielding only threads with
   * newly-added messages. A 404 means the history id expired — surfaced as `cursorExpired`.
   *
   * @remarks
   * Gmail's `historyId` on a `history.list` response is the mailbox's CURRENT history record,
   * not a per-page resumption token — the API's own guidance is to persist it only once
   * pagination is fully drained (no `nextPageToken`). Advancing the cursor from a page that
   * still has more pages behind it would permanently skip the un-fetched, older history: the
   * next incremental pull starts from "now" and those records are gone, not merely delayed.
   * If `maxThreads` is hit before the walk drains, the cursor is left unchanged — the next
   * sweep resumes this same walk from the same `startHistoryId` (re-fetching already-seen
   * threads is redundant but harmless; ingest is dedup'd downstream).
   */
  private async listThreadsIncremental(cursor: string, maxThreads: number): Promise<MailListPage> {
    const threadIds = new Set<string>();
    let historyId: string | undefined;
    let pageToken: string | undefined;
    try {
      do {
        const j = await this.http.getJson<GmailHistoryResponse>(
          `/users/me/history?startHistoryId=${cursor}&historyTypes=messageAdded&maxResults=100` +
            (pageToken ? `&pageToken=${pageToken}` : ''),
        );
        for (const record of j.history ?? []) {
          for (const added of record.messagesAdded ?? []) {
            const threadId = added.message?.threadId;
            if (threadId) threadIds.add(threadId);
          }
        }
        historyId = j.historyId ?? historyId;
        pageToken = j.nextPageToken;
      } while (pageToken && threadIds.size < maxThreads);
    } catch (error) {
      if (isConnectorError(error) && error.status === 404) return { kind: 'cursorExpired' };
      throw error;
    }
    const threads = await this.hydrateSummaries([...threadIds].slice(0, maxThreads));
    // Fully drained (no pageToken left) is the only case it's safe to advance the cursor.
    const exhausted = !pageToken;
    const nextCursor = exhausted && historyId ? historyId : cursor;
    return { kind: 'page', threads, nextCursor };
  }

  /** Hydrate thread ids into {@link MailThreadSummary}s via metadata `threads.get`. */
  private async hydrateSummaries(threadIds: readonly string[]): Promise<MailThreadSummary[]> {
    const summaries: MailThreadSummary[] = [];
    for (const threadId of threadIds) {
      const json = await this.http.getJson<GmailThreadResource>(
        `/users/me/threads/${threadId}?format=metadata${THREAD_METADATA_HEADERS}`,
      );
      const messages = json.messages ?? [];
      const latest = messages[messages.length - 1];
      if (!latest) continue; // an empty thread has nothing to ingest
      const message = this.toMailMessage(latest);
      summaries.push({
        threadId,
        subject: message.subject,
        snippet: message.snippet,
        from: message.from,
        receivedAt: message.sentAt,
        ...(message.rfc822MessageId !== undefined
          ? { rfc822MessageId: message.rfc822MessageId }
          : {}),
        externalUrl: gmailThreadUrl(threadId),
      });
    }
    return summaries;
  }

  /**
   * Map a {@link MailAction} onto Gmail's `threads.modify` label deltas, or the sentinel
   * `'trash'` for the dedicated trash endpoint.
   */
  private gmailDelta(action: MailAction): GmailModifyBody | 'trash' {
    switch (action.kind) {
      case 'archive':
        return { removeLabelIds: ['INBOX'] };
      case 'markRead':
        return { removeLabelIds: ['UNREAD'] };
      case 'markUnread':
        return { addLabelIds: ['UNREAD'] };
      case 'applyLabel':
        return { addLabelIds: [action.label] };
      case 'removeLabel':
        return { removeLabelIds: [action.label] };
      case 'trash':
        return 'trash';
    }
  }

  /** {@inheritDoc MailActionsProviderClient.applyMailAction} */
  async applyMailAction(input: MailActionInput): Promise<void> {
    const delta = this.gmailDelta(input.action);
    if (delta === 'trash') {
      await this.http.postJson(`/users/me/threads/${input.threadId}/trash`, {});
      return;
    }
    await this.http.postJson(`/users/me/threads/${input.threadId}/modify`, delta);
  }

  /** {@inheritDoc MailActionsProviderClient.fetchThread} */
  async fetchThread(input: FetchThreadInput): Promise<MailThread> {
    const json = await this.http.getJson<GmailThreadResource>(
      `/users/me/threads/${input.threadId}?format=metadata${THREAD_METADATA_HEADERS}`,
    );
    const messages = (json.messages ?? []).map((m) => this.toMailMessage(m));
    return {
      threadId: input.threadId,
      subject: messages[0]?.subject ?? `Thread ${input.threadId}`,
      messages,
      externalUrl: gmailThreadUrl(input.threadId),
    };
  }

  /** Project one Gmail message resource into a render-ready {@link MailMessage}. */
  private toMailMessage(m: GmailMessageResource): MailMessage {
    const header = (name: string): string | undefined =>
      m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
    const to = (header('To') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const sentAt = m.internalDate
      ? new Date(Number(m.internalDate)).toISOString()
      : (header('Date') ?? '');
    const messageId = header('Message-ID');
    const inReplyTo = header('In-Reply-To');
    // RFC 5322 References: whitespace-separated Message-IDs, oldest first.
    const references = (header('References') ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      id: m.id,
      from: header('From') ?? '',
      to,
      subject: header('Subject') ?? '',
      snippet: m.snippet ?? '',
      sentAt,
      ...(messageId !== undefined ? { rfc822MessageId: messageId } : {}),
      ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      references,
    };
  }
}
