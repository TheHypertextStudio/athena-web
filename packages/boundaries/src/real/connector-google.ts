import type {
  ConnectorProvider,
  ExternalWriteResult,
  ImportWorkInput,
  ImportedItem,
  LinkResourceInput,
  MirrorResult,
  MirrorStatusInput,
  ResourceRef,
  TaskPushOp,
} from '../ports/connector';
import { ConnectorError } from '../ports/connector-error';
import type { WritableConnectorProviderClient } from './connector-provider-client';
import type { ProviderHttp } from './connector-http';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** The Google product a {@link GoogleProviderClient} targets. */
export type GoogleProduct = Extract<ConnectorProvider, 'drive' | 'gmail' | 'calendar' | 'gtasks'>;

/** Drive `about` identity payload (the signed-in user's email/name). */
interface DriveAbout {
  user?: { emailAddress?: string; displayName?: string };
}
/** Gmail profile identity payload. */
interface GmailProfile {
  emailAddress?: string;
}
/** Google Tasks list-collection payload (used for identity + container enumeration). */
interface TaskListsPayload {
  items?: { id?: string; title?: string }[];
}
/** Calendar primary-calendar identity payload. */
interface CalendarPrimary {
  id?: string;
  summary?: string;
}

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
export class GoogleProviderClient implements WritableConnectorProviderClient {
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
      const json = await this.http.getJson<DriveAbout>('/about?fields=user');
      return json.user?.emailAddress ?? json.user?.displayName;
    }
    if (this.product === 'gmail') {
      const json = await this.http.getJson<GmailProfile>('/users/me/profile');
      return json.emailAddress;
    }
    if (this.product === 'gtasks') {
      // Validate the credential by listing task lists, but do NOT derive the account label from a
      // resource (a task-list title). The app supplies the identity label — the account's email,
      // from the linked Better Auth account — instead. Accounts ≠ resources.
      await this.http.getJson<TaskListsPayload>('/users/@me/lists?maxResults=1');
      return undefined;
    }
    const json = await this.http.getJson<CalendarPrimary>('/calendars/primary');
    return json.id ?? json.summary;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} */
  async importWork(input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    if (this.product === 'drive') return this.importDrive(importedAt);
    if (this.product === 'gmail') return this.importGmail(importedAt);
    if (this.product === 'gtasks') return this.importTasks(importedAt, input.listIds);
    return this.importCalendar(importedAt);
  }

  /**
   * Page through a Google list endpoint via `nextPageToken`, collecting all items.
   *
   * @remarks
   * Shared by every product import so pagination, the {@link MAX_IMPORT_PAGES} safety bound,
   * and the truncation warning are handled once. A truncated import logs a warning rather than
   * silently returning a partial set that looks complete.
   *
   * @param resource - Label for the truncation log (e.g. `'files'`).
   * @param buildUrl - Builds the request path for a given page token.
   * @param extract - Pulls `{ items, nextPageToken }` out of the (provider-specific) response.
   */
  private async paginate<T>(
    resource: string,
    buildUrl: (pageToken: string | undefined) => string,
    extract: (json: unknown) => { items: readonly T[]; nextPageToken: string | undefined },
  ): Promise<T[]> {
    const all: T[] = [];
    let pageToken: string | undefined;
    let truncated = false;
    for (let page = 0; page < MAX_IMPORT_PAGES; page++) {
      const { items, nextPageToken } = extract(await this.http.getJson(buildUrl(pageToken)));
      all.push(...items);
      if (!nextPageToken) break;
      pageToken = nextPageToken;
      if (page === MAX_IMPORT_PAGES - 1) truncated = true;
    }
    if (truncated) {
      logConnectorTruncation({
        provider: this.product,
        resource,
        fetched: all.length,
        maxPages: MAX_IMPORT_PAGES,
      });
    }
    return all;
  }

  /** List Drive files and map them onto document {@link ImportedItem}s. */
  private async importDrive(importedAt: string): Promise<ImportedItem[]> {
    interface DriveFile {
      id: string;
      name: string;
      webViewLink?: string;
    }
    const all = await this.paginate<DriveFile>(
      'files',
      (pageToken) =>
        `/files?fields=files(id,name,webViewLink),nextPageToken&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      (json) => {
        const j = json as { files?: DriveFile[]; nextPageToken?: string };
        return { items: j.files ?? [], nextPageToken: j.nextPageToken };
      },
    );
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
    const all = await this.paginate<GmailThread>(
      'threads',
      (pageToken) =>
        `/users/me/threads?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      (json) => {
        const j = json as { threads?: GmailThread[]; nextPageToken?: string };
        return { items: j.threads ?? [], nextPageToken: j.nextPageToken };
      },
    );
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
    const all = await this.paginate<CalEvent>(
      'events',
      (pageToken) =>
        `/calendars/primary/events?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      (json) => {
        const j = json as { items?: CalEvent[]; nextPageToken?: string };
        return { items: j.items ?? [], nextPageToken: j.nextPageToken };
      },
    );
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

  /**
   * Page through the user's Google Tasks lists (`/users/@me/lists`).
   *
   * @remarks
   * Shared by {@link importTasks} (which then pulls each list's tasks) and
   * {@link listContainers} (which surfaces them for the per-account "which lists to sync" UI).
   */
  private async fetchTaskLists(): Promise<{ id: string; title?: string }[]> {
    return this.paginate<{ id: string; title?: string }>(
      'tasklists',
      (pageToken) => `/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      (json) => {
        const j = json as { items?: { id: string; title?: string }[]; nextPageToken?: string };
        return { items: j.items ?? [], nextPageToken: j.nextPageToken };
      },
    );
  }

  /**
   * {@inheritDoc ConnectorProviderClient.listContainers}
   *
   * @remarks
   * Only Google Tasks has a container concept; the other Google products throw so a misrouted
   * call is loud, not a silently-empty list.
   */
  async listContainers(): Promise<ResourceRef[]> {
    if (this.product !== 'gtasks') {
      throw new ConnectorError(`listContainers is not supported for ${this.product}`, {
        provider: this.product,
        kind: 'provider',
      });
    }
    const lists = await this.fetchTaskLists();
    return lists.map((l) => ({ id: l.id, title: l.title ?? l.id }));
  }

  /**
   * List every Google Task across all of the user's task lists and map each onto a work
   * {@link ImportedItem} carrying the two-way sync anchors.
   *
   * @remarks
   * Unlike the old one-way mirror (`@default` list, open tasks only), two-way sync pulls:
   * - **all task lists** (`/users/@me/lists`), recording the owning `externalListId` so a
   *   write-back can address the right `/lists/{listId}/tasks/{taskId}`;
   * - **completed tasks** (`showCompleted=true&showHidden=true`) so a completion done in Google
   *   propagates down rather than looking like a deletion;
   * - **tombstones** (`showDeleted=true` → `deleted:true`) so a remote delete arrives as data
   *   (`removed:true`) instead of as absence.
   * Each item carries the provider's `updated` timestamp and `etag` as the last-write-wins
   * anchors. {@link MAX_IMPORT_PAGES} bounds pagination per list.
   */
  private async importTasks(
    importedAt: string,
    listIds?: readonly string[],
  ): Promise<ImportedItem[]> {
    const allLists = await this.fetchTaskLists();
    // Scope to the selected lists when the integration configured a subset; otherwise pull all.
    const selected = listIds && listIds.length > 0 ? new Set(listIds) : undefined;
    const lists = selected ? allLists.filter((l) => selected.has(l.id)) : allLists;

    interface GTask {
      id: string;
      title?: string;
      notes?: string;
      status?: string;
      due?: string;
      updated?: string;
      etag?: string;
      deleted?: boolean;
      webViewLink?: string;
    }
    const items: ImportedItem[] = [];
    for (const list of lists) {
      const tasks = await this.paginate<GTask>(
        'tasks',
        (pageToken) =>
          `/lists/${list.id}/tasks?showCompleted=true&showHidden=true&showDeleted=true&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
        (json) => {
          const j = json as { items?: GTask[]; nextPageToken?: string };
          return { items: j.items ?? [], nextPageToken: j.nextPageToken };
        },
      );
      for (const t of tasks) {
        items.push({
          id: t.id,
          kind: 'issue' as const,
          title: t.title && t.title.length > 0 ? t.title : '(untitled task)',
          ...(t.notes ? { body: t.notes } : {}),
          completed: t.status === 'completed',
          dueDate: t.due ?? null,
          ...(t.deleted ? { removed: true as const } : {}),
          provenance: {
            provider: 'gtasks' as const,
            externalId: t.id,
            ...(t.webViewLink ? { externalUrl: t.webViewLink } : {}),
            importedAt,
            ...(t.updated ? { externalUpdatedAt: t.updated } : {}),
            ...(t.etag ? { externalEtag: t.etag } : {}),
            externalListId: list.id,
          },
        });
      }
    }
    return items;
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

  /**
   * {@inheritDoc WritableConnectorProviderClient.pushTask}
   *
   * @remarks
   * Only Google Tasks (`gtasks`) supports write-back; the other Google products throw so a
   * misrouted push is loud, not silent. `create`/`update` return the provider's post-write
   * `updated`/`etag` (the new echo guard); `delete` returns `undefined` (a `204 No Content`).
   */
  async pushTask(op: TaskPushOp): Promise<ExternalWriteResult | undefined> {
    if (this.product !== 'gtasks') {
      throw new ConnectorError(`pushTask is not supported for ${this.product}`, {
        provider: this.product,
        kind: 'provider',
      });
    }
    if (op.kind === 'delete') {
      await this.http.deleteVoid(`/lists/${op.listId}/tasks/${op.externalId}`);
      return;
    }
    if (op.kind === 'create') {
      return this.toWriteResult(
        await this.http.postJson(`/lists/${op.listId}/tasks`, this.toTaskResource(op)),
      );
    }
    return this.toWriteResult(
      await this.http.patchJson(
        `/lists/${op.listId}/tasks/${op.externalId}`,
        this.toTaskResource(op),
      ),
    );
  }

  /**
   * Build the Google Tasks resource body for a create/update from the provider-agnostic op.
   *
   * @remarks
   * Maps Docket fields onto the Tasks API: `notes` for the description, `due` (RFC3339) for the
   * due date, and `status` (`completed`/`needsAction`) for completion — reopening also clears
   * the `completed` timestamp. A `null` `notes`/`dueDate` is sent through to clear the field;
   * note the Tasks API is finicky about clearing `due` (see the two-way sync plan's caveat).
   */
  private toTaskResource(fields: {
    title?: string;
    notes?: string | null;
    dueDate?: string | null;
    completed?: boolean;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (fields.title !== undefined) body['title'] = fields.title;
    if (fields.notes !== undefined) body['notes'] = fields.notes;
    if (fields.dueDate !== undefined) body['due'] = fields.dueDate;
    if (fields.completed !== undefined) {
      body['status'] = fields.completed ? 'completed' : 'needsAction';
      if (!fields.completed) body['completed'] = null;
    }
    return body;
  }

  /** Normalize a Google Tasks write response into the port's {@link ExternalWriteResult}. */
  private toWriteResult(json: unknown): ExternalWriteResult {
    const t = json as { id?: string; updated?: string; etag?: string };
    if (!t.id || !t.updated) {
      throw new ConnectorError('Google Tasks write returned no id/updated', {
        provider: this.product,
        kind: 'provider',
      });
    }
    return {
      externalId: t.id,
      externalUpdatedAt: t.updated,
      ...(t.etag ? { externalEtag: t.etag } : {}),
    };
  }
}
