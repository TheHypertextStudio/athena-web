/**
 * Layered calendar e2e coverage.
 *
 * @remarks
 * Signs up a real throwaway user (real passkey ceremony, real onboarding, real org) and drives
 * the layered-calendar surfaces — the full `/calendar` view, the item workspace drawer, and the
 * nested Google Calendar settings page — against deterministic `page.route(...)` fixtures for
 * `/v1/me/calendar*` and `/v1/agenda`, exactly the mock-network boundary
 * `google-calendar.spec.ts` already establishes: the shell, routing, TanStack Query, and
 * rendering are real; the provider (Google) and its network are not. A "provider 412" is
 * therefore represented the same way the real API surfaces it to this boundary — a 200 response
 * from the *Docket* API whose item body already reflects the post-push outcome
 * (`hasConflict: true`, `syncState: 'conflict'`) — never a literal HTTP 412, since this suite
 * never talks to Google directly.
 *
 * `/calendar` (unlike the settings page `google-calendar.spec.ts` covers) is a Server Component
 * that prefetches its calendar-layers/calendar-items reads on the server
 * (`getServerApi()` in `apps/web/src/lib/query-server.ts`) and hydrates the client from that
 * snapshot — a real server-to-server fetch `page.route(...)` cannot see or intercept, since it
 * never crosses the browser's network stack. Two ways this suite gets past that hydrated (real,
 * unmocked) snapshot to the mocked data every test actually wants:
 *
 * - {@link switchToWeekView} clicks "Week", which changes `calendarItemsDef`'s range and
 *   therefore its query key — a key with no cache entry always fetches on mount regardless of
 *   staleness, so this fetch goes through the browser (and the mocks) immediately. Cheap, and
 *   enough for every test that only reads the *items* range.
 * - {@link waitPastCalendarStaleness} is for the one test that also drives the layer-visibility
 *   *toggle*, which needs `calendarLayersDef`'s list correct too — that query key never changes
 *   with the view, so there is no cheap "new key" trick. TanStack's default
 *   `refetchOnWindowFocus` only refetches *stale* queries, so this waits past both reads'
 *   `staleTime` (`STALE.volatile`/`STALE.standard` in `apps/web/src/lib/query-core.ts`) and then
 *   dispatches `visibilitychange` to trigger the refetch.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import { orgHref, settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';

/** Switch the full calendar view to Week mode, forcing a fresh (mock-visible) items fetch. */
async function switchToWeekView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Week' }).click();
}

/**
 * Wait past both `calendarItemsDef`/`calendarLayersDef`'s `staleTime`, then dispatch
 * `visibilitychange` so TanStack's `refetchOnWindowFocus` refetches both through the browser.
 */
async function waitPastCalendarStaleness(page: Page): Promise<void> {
  await page.waitForTimeout(31_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });
}

const GOOGLE_CONNECTION_ID = '8CNV2AHRZ6ENW3BJS08FPX4CKT';
const GOOGLE_LAYER_RO_ID = '9FNV2AHRZ6ENW3BJS08FPX4CKT';
const GOOGLE_LAYER_RW_ID = 'AJNV2AHRZ6ENW3BJS08FPX4CKT';
const NATIVE_LAYER_ID = 'BNNV2AHRZ6ENW3BJS08FPX4CKT';
const EVT_RO_ID = 'CRNV2AHRZ6ENW3BJS08FPX4CKT';
const EVT_RW_ID = 'DVNV2AHRZ6ENW3BJS08FPX4CKT';
const EVT_CONFLICT_ID = 'EYNV2AHRZ6ENW3BJS08FPX4CKT';
const ITEM_LINK_TASKS_ID = 'G4PV2AHRZ6ENW3BJS08FPX4CKT';
const TASK_A = 'H7PV2AHRZ6ENW3BJS08FPX4CKT';
const TASK_LINK_EXISTING = 'EHSV2AHRZ6ENW3BJS08FPX4CKT';
const NATIVE_BLOCK_EXISTING_ID = '89SV2AHRZ6ENW3BJS08FPX4CKT';
const CREATED_BLOCK_ID = 'BDSV2AHRZ6ENW3BJS08FPX4CKT';

/** A `CalendarLayerOut` fixture with sane defaults, overridable per test. */
function makeLayer(overrides: Partial<CalendarLayerOut> & { id: string }): CalendarLayerOut {
  return {
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'Layer',
    description: null,
    timezone: null,
    color: '#16a34a',
    accessRole: null,
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * An ISO instant for "today" (the real clock, whenever the suite runs) at a given local hour.
 *
 * @remarks
 * The full calendar view's day/week grids only render items whose local day falls within the
 * currently displayed range (computed from the real "today" at render time) — a hardcoded
 * absolute date would silently vanish from the grid once the real date moves past it. Fixture
 * items anchor to "today" instead so they always land in view regardless of when this suite runs.
 */
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** A `CalendarItemOut` fixture with sane defaults, overridable per test. */
function makeItem(overrides: Partial<CalendarItemOut> & { id: string }): CalendarItemOut {
  return {
    layerId: NATIVE_LAYER_ID,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Item',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: todayAt(9),
    endsAt: todayAt(10),
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Mock `GET /v1/me/calendar/layers` to always return the current contents of `layers`. */
async function mockLayers(page: Page, layers: CalendarLayerOut[]) {
  await page.route('**/v1/me/calendar/layers', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { items: layers } });
  });
}

/** Mock `PATCH /v1/me/calendar/layers/:id` to mutate `layers` in place and echo the result. */
async function mockLayerPatch(page: Page, layers: CalendarLayerOut[]) {
  await page.route('**/v1/me/calendar/layers/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() as Partial<CalendarLayerOut>;
    const layer = layers.find((l) => l.id === id);
    if (layer) Object.assign(layer, body);
    await route.fulfill({ json: layer });
  });
}

/** Mock `GET /v1/me/calendar/items?...` to return every item in `items` overlapping any range. */
async function mockItemsRange(page: Page, layers: CalendarLayerOut[], items: CalendarItemOut[]) {
  await page.route('**/v1/me/calendar/items?**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const selectedLayerIds = new Set(layers.filter((l) => l.selected).map((l) => l.id));
    await route.fulfill({
      json: {
        layers: layers.filter((l) => selectedLayerIds.has(l.id)),
        items: items.filter((item) => selectedLayerIds.has(item.layerId)),
      },
    });
  });
}

/** Mock `POST /v1/me/calendar/items` (native-block create) to append to `items` and echo it. */
async function mockItemCreate(page: Page, items: CalendarItemOut[], nextId: string) {
  await page.route('**/v1/me/calendar/items', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Partial<CalendarItemOut>;
    const created = makeItem({
      id: nextId,
      layerId: NATIVE_LAYER_ID,
      kind: 'native_block',
      title: body.title ?? 'Untitled',
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    });
    items.push(created);
    await route.fulfill({ json: created });
  });
}

/** Mock `GET|PATCH|DELETE /v1/me/calendar/items/:id`, mutating/removing from `items` in place. */
async function mockItemDetail(page: Page, items: CalendarItemOut[]) {
  await page.route('**/v1/me/calendar/items/*', async (route) => {
    const method = route.request().method();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const item = items.find((i) => i.id === id);
    if (method === 'GET') {
      if (!item) return route.fulfill({ status: 404, json: { title: 'Not found' } });
      await route.fulfill({ json: item });
      return;
    }
    if (method === 'PATCH') {
      if (!item) return route.fulfill({ status: 404, json: { title: 'Not found' } });
      const patch = route.request().postDataJSON() as Partial<CalendarItemOut>;
      Object.assign(item, patch);
      await route.fulfill({ json: item });
      return;
    }
    if (method === 'DELETE') {
      const index = items.findIndex((i) => i.id === id);
      const removed = index >= 0 ? items.splice(index, 1)[0] : undefined;
      await route.fulfill({ json: removed ?? { id } });
      return;
    }
    await route.fallback();
  });
}

/** Mock `POST /v1/me/calendar/items/:id/tasks` — link-existing or create-and-link. */
async function mockTaskLink(page: Page, items: CalendarItemOut[]) {
  await page.route('**/v1/me/calendar/items/*/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const id = route.request().url().split('/items/')[1]?.split('/tasks')[0];
    const item = items.find((i) => i.id === id);
    const body = route.request().postDataJSON() as {
      mode: 'link' | 'create';
      taskId?: string;
      title?: string;
      role?: CalendarItemOut['linkedTasks'][number]['role'];
    };
    const taskId = body.mode === 'link' ? (body.taskId ?? TASK_LINK_EXISTING) : TASK_A;
    const title = body.mode === 'create' ? (body.title ?? 'New task') : 'Existing task';
    const link = {
      taskId,
      organizationId: item?.linkedTasks[0]?.organizationId ?? '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      role: body.role ?? 'related',
      sort: item?.linkedTasks.length ?? 0,
      note: null,
      title,
      state: 'backlog',
      done: false,
    };
    if (item) item.linkedTasks = [...item.linkedTasks, link];
    await route.fulfill({
      json: { link, task: { id: taskId, title, state: 'backlog' } },
    });
  });
}

test.describe('layered calendar', () => {
  test('read-only Google account: visible in agenda and the full calendar view, edit controls disabled with a reason', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'ReadOnly');

    const layers = [
      makeLayer({
        id: GOOGLE_LAYER_RO_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        title: 'Ada',
        accessRole: 'owner',
        editableCore: false,
      }),
    ];
    const items = [
      makeItem({
        id: EVT_RO_ID,
        layerId: GOOGLE_LAYER_RO_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        kind: 'provider_event',
        provider: 'google',
        title: 'Design review',
        permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
      }),
    ];

    await mockLayers(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemDetail(page, items);
    await page.route('**/v1/me/calendar', async (route) => {
      await route.fulfill({
        json: {
          connections: [
            {
              id: GOOGLE_CONNECTION_ID,
              provider: 'google',
              externalAccountId: 'google-sub-1',
              accountEmail: 'ada@example.com',
              accountName: 'Ada Lovelace',
              accountPictureUrl: null,
              status: 'connected',
              calendarsTotal: 1,
              calendarsEnabled: 1,
              lastSyncedAt: '2026-07-05T16:00:00.000Z',
              lastError: null,
              scopeState: {
                grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
                calendarRead: true,
                calendarWrite: false,
                capturedAt: '2026-07-05T15:00:00.000Z',
              },
              createdAt: '2026-07-05T15:00:00.000Z',
              updatedAt: '2026-07-05T16:00:00.000Z',
            },
          ],
          calendars: [],
          layers,
        },
      });
    });
    await page.route('**/v1/agenda?**', async (route) => {
      await route.fulfill({
        json: {
          date: '2026-07-06',
          entries: [
            {
              kind: 'google_calendar_event',
              event: {
                id: '01BX5ZZKBKACTAV9WEVGEMMVS0',
                connectionId: GOOGLE_CONNECTION_ID,
                calendarId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
                externalCalendarId: 'primary',
                externalEventId: 'event-1',
                status: 'confirmed',
                title: 'Design review',
                description: null,
                location: null,
                htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
                startsAt: '2026-07-06T16:00:00.000Z',
                endsAt: '2026-07-06T17:00:00.000Z',
                allDayStartDate: null,
                allDayEndDate: null,
                organizer: null,
                attendees: [],
                updatedExternalAt: null,
                createdAt: '2026-07-05T15:00:00.000Z',
                updatedAt: '2026-07-05T16:00:00.000Z',
              },
              connection: {
                id: GOOGLE_CONNECTION_ID,
                accountEmail: 'ada@example.com',
                accountName: 'Ada',
              },
              calendar: {
                id: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
                title: 'Ada',
                color: '#16a34a',
                timezone: null,
              },
            },
          ],
        },
      });
    });

    // The account settings surface shows the read-only write-scope status.
    await page.goto(settingsHref(orgId, 'connections/google-calendar'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('Calendar read-only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable calendar editing' })).toBeEnabled();

    // The (shell-wide) agenda rail still shows the event.
    await page.goto(orgHref(orgId, 'my-work'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Design review').first()).toBeVisible();

    // The full calendar view renders the item with a visible read-only reason.
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await switchToWeekView(page);
    await expect(page.getByRole('img', { name: /Read-only/ })).toBeVisible();
    await page.getByText('Design review').first().click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Read-only — no calendar write access granted')).toBeVisible();
    await expect(drawer.getByLabel('Title')).toBeDisabled();
    await expect(drawer.getByLabel('Description')).toBeDisabled();
    await expect(drawer.getByLabel('Location')).toBeDisabled();
    await expect(drawer.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });

  test('layer visibility toggles the calendar view live, without a page reload', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'LayerToggle');
    void orgId;

    const layers = [makeLayer({ id: NATIVE_LAYER_ID, title: 'Focus blocks', selected: true })];
    const items = [
      makeItem({
        id: NATIVE_BLOCK_EXISTING_ID,
        layerId: NATIVE_LAYER_ID,
        title: 'Deep work',
      }),
    ];

    await mockLayers(page, layers);
    await mockLayerPatch(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemDetail(page, items);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await waitPastCalendarStaleness(page);
    await expect(page.getByText('Deep work')).toBeVisible();

    // A marker on `window` only survives while the document is never replaced — proves the
    // toggle below reshapes the page in place rather than triggering a full navigation/reload.
    await page.evaluate(() => {
      (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker = true;
    });

    const toggle = page.getByRole('checkbox', { name: 'Toggle Focus blocks visibility' });
    await toggle.click();
    await expect(page.getByText('Deep work')).toHaveCount(0);

    await toggle.click();
    await expect(page.getByText('Deep work')).toBeVisible();

    const marker = await page.evaluate(
      () => (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker,
    );
    expect(marker).toBe(true);
  });

  test('native block: create, edit, delete — no provider account needed', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'NativeBlock');
    void orgId;

    const layers = [makeLayer({ id: NATIVE_LAYER_ID, title: 'My blocks' })];
    const items: CalendarItemOut[] = [];

    await mockLayers(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemCreate(page, items, CREATED_BLOCK_ID);
    await mockItemDetail(page, items);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'New block' }).click();
    await page.getByLabel('Title').fill('Focus block');
    await page.getByRole('button', { name: 'Create block' }).click();

    await expect(page.getByText('Focus block')).toBeVisible();

    await page.getByText('Focus block').click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Title').fill('Deep focus block');
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer.getByRole('heading', { name: 'Deep focus block' })).toBeVisible();

    await drawer.getByRole('button', { name: 'Delete block' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Deep focus block')).toHaveCount(0);
  });

  test('create multiple tasks from one calendar item — create-and-link and link-existing both appear', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'LinkTasks');
    void orgId;

    const layers = [makeLayer({ id: NATIVE_LAYER_ID, title: 'My blocks' })];
    const items = [
      makeItem({ id: ITEM_LINK_TASKS_ID, layerId: NATIVE_LAYER_ID, title: 'Quarterly planning' }),
    ];

    await mockLayers(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemDetail(page, items);
    await mockTaskLink(page, items);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await switchToWeekView(page);
    await expect(page.getByText('Quarterly planning')).toBeVisible();
    await page.getByText('Quarterly planning').click();
    const drawer = page.getByRole('dialog');

    await drawer.getByRole('button', { name: 'New' }).click();
    await drawer.getByLabel('Title (optional)').fill('Prep the deck');
    await drawer.getByRole('button', { name: 'Create & link' }).click();
    await expect(drawer.getByText('Prep the deck')).toBeVisible();

    await drawer.getByRole('button', { name: 'Link' }).click();
    await drawer.getByLabel('Task ID').fill(TASK_LINK_EXISTING);
    await drawer.getByRole('button', { name: 'Link task' }).click();
    await expect(drawer.getByText('Existing task')).toBeVisible();

    await expect(drawer.getByText('Prep the deck')).toBeVisible();
    await expect(drawer.getByText('Existing task')).toBeVisible();
  });

  test('editable provider event: inline edit pushes to the provider and reflects a clean sync state', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'WriteBack');
    void orgId;

    const layers = [
      makeLayer({
        id: GOOGLE_LAYER_RW_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        title: 'Ada',
        editableCore: true,
      }),
    ];
    const items = [
      makeItem({
        id: EVT_RW_ID,
        layerId: GOOGLE_LAYER_RW_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        kind: 'provider_event',
        provider: 'google',
        title: 'Design review',
        syncState: 'clean',
      }),
    ];

    await mockLayers(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemDetail(page, items);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await switchToWeekView(page);
    await expect(page.getByText('Design review')).toBeVisible();
    await page.getByText('Design review').click();
    const drawer = page.getByRole('dialog');

    await drawer.getByLabel('Title').fill('Design review (revised)');
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    await expect(drawer.getByRole('heading', { name: 'Design review (revised)' })).toBeVisible();
    await expect(drawer.getByText('Synced')).toBeVisible();
  });

  test('conflict shows a banner with both recovery actions; a read-only event shows a disabled reason', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'ConflictReadOnly');
    void orgId;

    const layers = [
      makeLayer({
        id: GOOGLE_LAYER_RW_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        title: 'Ada',
        editableCore: true,
      }),
    ];
    const items = [
      makeItem({
        id: EVT_CONFLICT_ID,
        layerId: GOOGLE_LAYER_RW_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        kind: 'provider_event',
        provider: 'google',
        title: 'Budget sync',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=budget-sync',
        syncState: 'conflict',
        hasConflict: true,
      }),
      makeItem({
        id: EVT_RO_ID,
        layerId: GOOGLE_LAYER_RW_ID,
        connectionId: GOOGLE_CONNECTION_ID,
        kind: 'provider_event',
        provider: 'google',
        title: 'All-hands',
        startsAt: todayAt(13),
        endsAt: todayAt(14),
        permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
      }),
    ];

    await mockLayers(page, layers);
    await mockItemsRange(page, layers, items);
    await mockItemDetail(page, items);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await switchToWeekView(page);
    await expect(page.getByText('Budget sync')).toBeVisible();

    await test.step('conflict banner renders both recovery actions', async () => {
      await page.getByText('Budget sync').click();
      const drawer = page.getByRole('dialog');
      const banner = drawer.getByRole('alert').filter({ hasText: 'Sync conflict' });
      await expect(banner).toBeVisible();
      await expect(banner.getByRole('link', { name: 'Open in provider' })).toBeVisible();
      await expect(banner.getByRole('button', { name: 'Retry with local changes' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await test.step('read-only event shows disabled controls with the write-scope-required reason', async () => {
      await page.getByText('All-hands').click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByText('Read-only — no calendar write access granted')).toBeVisible();
      await expect(drawer.getByLabel('Title')).toBeDisabled();
    });
  });
});
