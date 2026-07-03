/**
 * `@docket/boundaries/real` — the Google product connector clients (Drive / Calendar /
 * Tasks) and the shared Google pagination helper.
 *
 * @remarks
 * One client class per product, each implementing exactly the capabilities the product
 * has: Drive and Calendar are read-only base clients; Google Tasks additionally
 * implements the writable provider-client interface (task write-back + containers).
 * Gmail lives in `./connector-gmail` and implements the mail interface. Capability is
 * therefore **structural** — the connector discovers it via the `is*ProviderClient`
 * guards — with no provider-literal gates anywhere. All request building and response
 * mapping is pure and unit-tested through the injected client.
 */
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
import type {
  ConnectorProviderClient,
  ResolvedAccount,
  WritableConnectorProviderClient,
} from './connector-provider-client';
import type { ProviderHttp } from './connector-http';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** The Google products served by the per-product clients in this module + `./connector-gmail`. */
export type GoogleProduct = Extract<ConnectorProvider, 'drive' | 'gmail' | 'calendar' | 'gtasks'>;

/** Drive `about` identity payload (the signed-in user's email/name). */
interface DriveAbout {
  user?: { emailAddress?: string; displayName?: string };
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
 * Page through a Google list endpoint via `nextPageToken`, collecting all items.
 *
 * @remarks
 * Shared by every Google product import (including Gmail's) so pagination, the
 * {@link MAX_IMPORT_PAGES} safety bound, and the truncation warning are handled once. A
 * truncated import logs a warning rather than silently returning a partial set that looks
 * complete.
 *
 * @param http - The product's HTTP wrapper.
 * @param product - The product, for the truncation log.
 * @param resource - Label for the truncation log (e.g. `'files'`).
 * @param opts - `buildUrl` builds the request path for a page token; `extract` pulls
 *   `{ items, nextPageToken }` out of the (product-specific) response.
 */
export async function paginateGoogle<T>(
  http: ProviderHttp,
  product: GoogleProduct,
  resource: string,
  opts: {
    buildUrl: (pageToken: string | undefined) => string;
    extract: (json: unknown) => { items: readonly T[]; nextPageToken: string | undefined };
  },
): Promise<T[]> {
  const all: T[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  for (let page = 0; page < MAX_IMPORT_PAGES; page++) {
    const { items, nextPageToken } = opts.extract(await http.getJson(opts.buildUrl(pageToken)));
    all.push(...items);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
    if (page === MAX_IMPORT_PAGES - 1) truncated = true;
  }
  if (truncated) {
    logConnectorTruncation({
      provider: product,
      resource,
      fetched: all.length,
      maxPages: MAX_IMPORT_PAGES,
    });
  }
  return all;
}

/**
 * The Google Drive connector client (read-only documents surface).
 */
export class GoogleDriveProviderClient implements ConnectorProviderClient {
  /** @param http - The provider HTTP wrapper bound to the Drive API base. */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const json = await this.http.getJson<DriveAbout>('/about?fields=user');
    const label = json.user?.emailAddress ?? json.user?.displayName;
    return label !== undefined ? { label } : undefined;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} — Drive files as document items. */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    interface DriveFile {
      id: string;
      name: string;
      webViewLink?: string;
    }
    const all = await paginateGoogle<DriveFile>(this.http, 'drive', 'files', {
      buildUrl: (pageToken) =>
        `/files?fields=files(id,name,webViewLink),nextPageToken&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      extract: (json) => {
        const j = json as { files?: DriveFile[]; nextPageToken?: string };
        return { items: j.files ?? [], nextPageToken: j.nextPageToken };
      },
    });
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

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: 'drive' },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    return `https://drive.google.com/file/d/${input.externalId}`;
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} — Drive has no container concept. */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }
}

/**
 * The Google Calendar connector client (read-only events surface).
 */
export class GoogleCalendarProviderClient implements ConnectorProviderClient {
  /** @param http - The provider HTTP wrapper bound to the Calendar API base. */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const json = await this.http.getJson<CalendarPrimary>('/calendars/primary');
    const label = json.id ?? json.summary;
    return label !== undefined ? { label } : undefined;
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} — primary-calendar events as event items. */
  async importWork(_input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    interface CalEvent {
      id: string;
      summary?: string;
      description?: string;
      htmlLink?: string;
    }
    const all = await paginateGoogle<CalEvent>(this.http, 'calendar', 'events', {
      buildUrl: (pageToken) =>
        `/calendars/primary/events?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      extract: (json) => {
        const j = json as { items?: CalEvent[]; nextPageToken?: string };
        return { items: j.items ?? [], nextPageToken: j.nextPageToken };
      },
    });
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

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} */
  async mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    const items = await this.importWork(
      { connectionId: input.connectionId, provider: 'calendar' },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    return `https://calendar.google.com/calendar/event?eid=${input.externalId}`;
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} — Calendar has no container concept. */
  async listContainers(): Promise<ResourceRef[]> {
    return [];
  }
}

/**
 * The Google Tasks connector client (two-way sync: import + write-back + containers).
 */
export class GoogleTasksProviderClient implements WritableConnectorProviderClient {
  /** @param http - The provider HTTP wrapper bound to the Tasks API base. */
  constructor(private readonly http: ProviderHttp) {}

  /**
   * {@inheritDoc ConnectorProviderClient.resolveAccount}
   *
   * @remarks
   * Validates the credential by listing task lists, but does NOT derive the account label
   * from a resource (a task-list title). The app supplies the identity label — the
   * account's email, from the linked Better Auth account — instead. Accounts ≠ resources.
   */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    await this.http.getJson<TaskListsPayload>('/users/@me/lists?maxResults=1');
    return undefined;
  }

  /**
   * Page through the user's Google Tasks lists (`/users/@me/lists`).
   *
   * @remarks
   * Shared by {@link GoogleTasksProviderClient.importWork} (which then pulls each list's
   * tasks) and {@link GoogleTasksProviderClient.listContainers} (which surfaces them for
   * the per-account "which lists to sync" UI).
   */
  private async fetchTaskLists(): Promise<{ id: string; title?: string }[]> {
    return paginateGoogle<{ id: string; title?: string }>(this.http, 'gtasks', 'tasklists', {
      buildUrl: (pageToken) =>
        `/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
      extract: (json) => {
        const j = json as { items?: { id: string; title?: string }[]; nextPageToken?: string };
        return { items: j.items ?? [], nextPageToken: j.nextPageToken };
      },
    });
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} */
  async listContainers(): Promise<ResourceRef[]> {
    const lists = await this.fetchTaskLists();
    return lists.map((l) => ({ id: l.id, title: l.title ?? l.id }));
  }

  /**
   * List every Google Task across the user's task lists and map each onto a work
   * {@link ImportedItem} carrying the two-way sync anchors.
   *
   * @remarks
   * Two-way sync pulls: **all task lists** (recording the owning `externalListId` so a
   * write-back can address the right `/lists/{listId}/tasks/{taskId}`); **completed tasks**
   * (`showCompleted=true&showHidden=true`) so a completion done in Google propagates down
   * rather than looking like a deletion; and **tombstones** (`showDeleted=true` →
   * `removed:true`) so a remote delete arrives as data instead of as absence. Each item
   * carries the provider's `updated` timestamp and `etag` as the last-write-wins anchors.
   */
  async importWork(input: ImportWorkInput, importedAt: string): Promise<ImportedItem[]> {
    const allLists = await this.fetchTaskLists();
    // Scope to the selected lists when the integration configured a subset; otherwise pull all.
    const selected = input.listIds && input.listIds.length > 0 ? new Set(input.listIds) : undefined;
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
      const tasks = await paginateGoogle<GTask>(this.http, 'gtasks', 'tasks', {
        buildUrl: (pageToken) =>
          `/lists/${list.id}/tasks?showCompleted=true&showHidden=true&showDeleted=true&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`,
        extract: (json) => {
          const j = json as { items?: GTask[]; nextPageToken?: string };
          return { items: j.items ?? [], nextPageToken: j.nextPageToken };
        },
      });
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
      { connectionId: input.connectionId, provider: 'gtasks' },
      new Date(0).toISOString(),
    );
    return { connectionId: input.connectionId, status: 'idle', itemCount: items.length };
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    return `https://tasks.google.com/task/${input.externalId}`;
  }

  /**
   * {@inheritDoc WritableConnectorProviderClient.pushTask}
   *
   * @remarks
   * `create`/`update` return the provider's post-write `updated`/`etag` (the new echo
   * guard); `delete` returns `undefined` (a `204 No Content`).
   */
  async pushTask(op: TaskPushOp): Promise<ExternalWriteResult | undefined> {
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
   * Maps Docket fields onto the Tasks API: `notes` for the description, `due` (RFC3339) for
   * the due date, and `status` (`completed`/`needsAction`) for completion — reopening also
   * clears the `completed` timestamp. A `null` `notes`/`dueDate` is sent through to clear
   * the field; note the Tasks API is finicky about clearing `due` (see the two-way sync
   * plan's caveat).
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
        provider: 'gtasks',
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
