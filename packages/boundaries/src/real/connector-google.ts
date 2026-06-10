import type {
  ConnectorProvider,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
} from '../ports/connector';
import type { ConnectorProviderClient } from './connector-provider-client';
import type { ProviderHttp } from './connector-http';

/** The Google product a {@link GoogleProviderClient} targets. */
export type GoogleProduct = Extract<ConnectorProvider, 'drive' | 'gmail' | 'calendar' | 'gtasks'>;

/**
 * The Google connector client (Drive / Gmail / Calendar / Tasks REST, OAuth bearer).
 *
 * @remarks
 * `resolveAccount` reads the product's identity endpoint; `importWork` lists the
 * product's primary collection and normalizes each into an {@link ImportedItem};
 * `mirrorStatus` sizes the same listing; `resolveExternalUrl` reconstructs the
 * canonical product URL. One {@link GoogleProviderClient} is parameterized by the
 * concrete product so the providers share the bearer-token transport and mapping.
 */
export class GoogleProviderClient implements ConnectorProviderClient {
  /**
   * @param product - Which Google product this client targets.
   * @param http - The provider HTTP wrapper bound to the product's API base.
   */
  constructor(
    private readonly product: GoogleProduct,
    private readonly http: ProviderHttp,
  ) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<string | undefined> {
    if (this.product === 'drive') {
      const json = (await this.http.getJson('/about?fields=user')) as {
        user?: { emailAddress?: string; displayName?: string };
      };
      return json.user?.emailAddress ?? json.user?.displayName;
    }
    if (this.product === 'gmail') {
      const json = (await this.http.getJson('/users/me/profile')) as { emailAddress?: string };
      return json.emailAddress;
    }
    if (this.product === 'gtasks') {
      const json = (await this.http.getJson('/users/@me/lists?maxResults=1')) as {
        items?: { id?: string; title?: string }[];
      };
      const list = json.items?.[0];
      return list?.title ?? list?.id;
    }
    const json = (await this.http.getJson('/calendars/primary')) as {
      id?: string;
      summary?: string;
    };
    return json.id ?? json.summary;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    if (this.product === 'drive') return this.importDrive(importedAt);
    if (this.product === 'gmail') return this.importGmail(importedAt);
    if (this.product === 'gtasks') return this.importTasks(importedAt);
    return this.importCalendar(importedAt);
  }

  /** List Drive files and map them onto document {@link ImportedItem}s. */
  private async importDrive(importedAt: string): Promise<ImportedItem[]> {
    interface DriveFile {
      id: string;
      name: string;
      webViewLink?: string;
    }
    const all: DriveFile[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/files?fields=files(id,name,webViewLink),nextPageToken&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const json = (await this.http.getJson(url)) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      all.push(...(json.files ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return all.map((f) => ({
      id: f.id,
      kind: 'document' as const,
      title: f.name,
      provenance: {
        provider: 'drive' as const,
        externalId: f.id,
        ...(f.webViewLink ? { externalUrl: f.webViewLink } : {}),
        importedAt,
      },
    }));
  }

  /**
   * List Gmail threads and map them onto message {@link ImportedItem}s.
   *
   * @remarks
   * Uses `threads.list` (not `messages.list`) because it returns a `snippet`
   * — the first ~100 chars of the latest message — which makes a readable title.
   */
  private async importGmail(importedAt: string): Promise<ImportedItem[]> {
    interface GmailThread {
      id: string;
      snippet?: string;
    }
    const all: GmailThread[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/users/me/threads?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const json = (await this.http.getJson(url)) as {
        threads?: GmailThread[];
        nextPageToken?: string;
      };
      all.push(...(json.threads ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return all.map((t) => ({
      id: t.id,
      kind: 'message' as const,
      title: t.snippet ? t.snippet.slice(0, 80) : `Thread ${t.id}`,
      provenance: { provider: 'gmail' as const, externalId: t.id, importedAt },
    }));
  }

  /** List Calendar events and map them onto event {@link ImportedItem}s. */
  private async importCalendar(importedAt: string): Promise<ImportedItem[]> {
    interface CalEvent {
      id: string;
      summary?: string;
      description?: string;
      htmlLink?: string;
    }
    const all: CalEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/calendars/primary/events?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const json = (await this.http.getJson(url)) as {
        items?: CalEvent[];
        nextPageToken?: string;
      };
      all.push(...(json.items ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return all.map((e) => ({
      id: e.id,
      kind: 'event' as const,
      title: e.summary ?? '(no title)',
      ...(e.description ? { body: e.description } : {}),
      provenance: {
        provider: 'calendar' as const,
        externalId: e.id,
        ...(e.htmlLink ? { externalUrl: e.htmlLink } : {}),
        importedAt,
      },
    }));
  }

  /** List the user's open Google Tasks (default list) and map them onto work {@link ImportedItem}s. */
  private async importTasks(importedAt: string): Promise<ImportedItem[]> {
    interface GTask {
      id: string;
      title?: string;
      notes?: string;
      status?: string;
      webViewLink?: string;
    }
    const all: GTask[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/lists/@default/tasks?showCompleted=false&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const json = (await this.http.getJson(url)) as { items?: GTask[]; nextPageToken?: string };
      all.push(...(json.items ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return all.map((t) => ({
      id: t.id,
      kind: 'issue' as const,
      title: t.title && t.title.length > 0 ? t.title : '(untitled task)',
      ...(t.notes ? { body: t.notes } : {}),
      provenance: {
        provider: 'gtasks' as const,
        externalId: t.id,
        ...(t.webViewLink ? { externalUrl: t.webViewLink } : {}),
        importedAt,
      },
    }));
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: this.product },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    if (this.product === 'drive') return `https://drive.google.com/file/d/${input.externalId}`;
    if (this.product === 'gmail') return `https://mail.google.com/mail/#all/${input.externalId}`;
    if (this.product === 'gtasks') return `https://tasks.google.com/task/${input.externalId}`;
    return `https://calendar.google.com/calendar/event?eid=${input.externalId}`;
  }
}
