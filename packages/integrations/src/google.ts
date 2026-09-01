/**
 * `@docket/integrations` — the Google product connector clients (Calendar /
 * Tasks) and the shared Google pagination helper.
 *
 * @remarks
 * One client class per product, each implementing exactly the capabilities the product
 * has: Calendar is read-only; Google Tasks additionally
 * implements the writable provider-client interface (task write-back + containers).
 * Gmail lives in `./gmail` and implements the mail interface. Capability is
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
} from './connector';
import type { ExternalResourceType } from '@docket/connections/resource-provider-contract';
import { ConnectorError } from './connector-error';
import type {
  ConnectorProviderClient,
  ResolvedAccount,
  WritableConnectorProviderClient,
} from './provider-client';
import type { ProviderHttp } from './provider-http';
import type {
  ExternalResource,
  ResolveResourceInput,
  ResourceSearch,
  ResourceSearchInput,
  ResourceSearchPage,
} from './resource-search';
import { MAX_IMPORT_PAGES, logConnectorTruncation } from './connector-log';

/** The Google products served by the per-product clients in this module + `./gmail`. */
export type GoogleProduct = Extract<ConnectorProvider, 'gmail' | 'calendar' | 'gtasks' | 'drive'>;
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

/** A Drive file as the `files` API returns it, restricted to the fields the picker asks for. */
interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  description?: string;
  iconLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: { displayName?: string }[];
}

/** Drive's `files.list` response. */
interface DriveFileList {
  files?: DriveFile[];
}

/** The fields the picker and hovercard need, and nothing else. */
const DRIVE_FIELDS =
  'files(id,name,mimeType,description,iconLink,webViewLink,modifiedTime,owners(displayName))';

/** How many results one picker keystroke asks Drive for. */
const DRIVE_PAGE_SIZE = 10;

/**
 * Map a Drive MIME type onto Docket's own resource taxonomy.
 *
 * @remarks
 * Exhaustive by construction: anything unrecognized becomes `file`, which is true rather than a
 * guess. A raw MIME type must never reach the UI.
 */
function driveResourceType(mimeType: string | undefined): ExternalResourceType {
  if (mimeType === undefined) return 'file';
  if (mimeType === 'application/vnd.google-apps.document') return 'document';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'presentation';
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (mimeType === 'application/vnd.google-apps.form') return 'page';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Escape a value for Drive's query language.
 *
 * @remarks
 * Drive delimits query literals with `'`, so a name containing one would produce a 400 on every
 * keystroke. The backslash is escaped first, or escaping the quote would itself be undone.
 */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Project one Drive file into the shared resource shape. */
function toExternalResource(file: DriveFile): ExternalResource | undefined {
  if (file.id === undefined || file.webViewLink === undefined) return undefined;
  const ownerLabel = file.owners?.[0]?.displayName;
  return {
    provider: 'google_drive',
    externalId: file.id,
    resourceType: driveResourceType(file.mimeType),
    title: file.name ?? file.id,
    url: file.webViewLink,
    // Omitted rather than nulled when Drive does not report it: an absent field renders as nothing,
    // where a fabricated one renders as a fact.
    ...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
    ...(file.iconLink === undefined ? {} : { iconUrl: file.iconLink }),
    ...(file.description === undefined ? {} : { description: file.description }),
    ...(ownerLabel === undefined ? {} : { ownerLabel }),
    ...(file.modifiedTime === undefined ? {} : { modifiedAt: file.modifiedTime }),
  };
}

/**
 * Google Drive as a searchable resource source.
 *
 * @remarks
 * Contributes no work items, so `importWork` returns nothing and `mirrorStatus` reports idle —
 * truthfully, rather than pretending to sync. Its whole purpose is {@link ResourceSearch}.
 *
 * Search deliberately does not paginate: the picker wants the best ten under a deadline, not
 * completeness, and a second page would arrive after the user has typed another character.
 */
export class GoogleDriveProviderClient implements ConnectorProviderClient, ResourceSearch {
  /** @param http - The provider HTTP wrapper bound to the Drive API base. */
  constructor(private readonly http: ProviderHttp) {}

  /** {@inheritDoc ConnectorProviderClient.resolveAccount} */
  async resolveAccount(): Promise<ResolvedAccount | undefined> {
    const json = await this.http.getJson<{ user?: { emailAddress?: string } }>(
      '/about?fields=user(emailAddress)',
    );
    const label = json.user?.emailAddress;
    return label === undefined ? undefined : { label };
  }

  /** {@inheritDoc ConnectorProviderClient.importWork} — Drive holds documents, not work items. */
  importWork(): Promise<ImportedItem[]> {
    return Promise.resolve([]);
  }

  /** {@inheritDoc ConnectorProviderClient.mirrorStatus} — nothing to mirror. */
  mirrorStatus(input: MirrorStatusInput): Promise<MirrorResult> {
    return Promise.resolve({ connectionId: input.connectionId, status: 'idle', itemCount: 0 });
  }

  /** {@inheritDoc ConnectorProviderClient.resolveExternalUrl} */
  async resolveExternalUrl(input: LinkResourceInput): Promise<string | undefined> {
    const found = await this.resolveResource({ externalId: input.externalId });
    return found?.url;
  }

  /** {@inheritDoc ConnectorProviderClient.listContainers} — the shared drives available. */
  async listContainers(): Promise<ResourceRef[]> {
    const json = await this.http.getJson<{ drives?: { id?: string; name?: string }[] }>(
      '/drives?pageSize=100&fields=drives(id,name)',
    );
    return (json.drives ?? []).flatMap((drive) =>
      drive.id === undefined ? [] : [{ id: drive.id, title: drive.name ?? drive.id }],
    );
  }

  /** {@inheritDoc ResourceSearch.searchResources} */
  async searchResources(input: ResourceSearchInput): Promise<ResourceSearchPage> {
    const needle = input.query.trim();
    const limit = Math.min(input.limit, DRIVE_PAGE_SIZE);
    // `trashed = false` is always ANDed: a deleted file must never be offered as mentionable.
    const q =
      needle === ''
        ? 'trashed = false'
        : `name contains '${escapeDriveQuery(needle)}' and trashed = false`;
    const orderBy = needle === '' ? 'viewedByMeTime desc' : 'modifiedTime desc';
    const path =
      `/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(DRIVE_FIELDS)}` +
      `&orderBy=${encodeURIComponent(orderBy)}&pageSize=${limit}` +
      `&corpora=allDrives&includeItemsFromAllDrives=true&supportsAllDrives=true&spaces=drive`;

    const json = await this.http.getJson<DriveFileList>(path);
    const files = json.files ?? [];
    return {
      resources: files.flatMap((file) => {
        const resource = toExternalResource(file);
        return resource === undefined ? [] : [resource];
      }),
      // A full page means Drive cut the result set, which the client must not narrow locally.
      truncated: files.length >= limit,
    };
  }

  /** {@inheritDoc ResourceSearch.resolveResource} */
  async resolveResource(input: ResolveResourceInput): Promise<ExternalResource | undefined> {
    const fields = DRIVE_FIELDS.replace(/^files\(/, '').replace(/\)$/, '');
    const json = await this.http.getJson<DriveFile>(
      `/files/${encodeURIComponent(input.externalId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    );
    return toExternalResource(json);
  }
}
