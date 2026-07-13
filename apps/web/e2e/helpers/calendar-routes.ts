/** Browser-visible route fixtures for the layered and fluid calendar E2E contracts. */
import {
  CalendarItemCreate,
  CalendarItemRelationCreate,
  CalendarItemTaskLinkCreate,
} from '@docket/types';
import type {
  AgendaOut,
  CalendarItemCreate as CalendarItemCreateType,
  CalendarItemOut,
  CalendarItemRelationCreate as CalendarItemRelationCreateType,
  CalendarItemRelationOut,
  CalendarItemTaskLinkCreate as CalendarItemTaskLinkCreateType,
  CalendarItemUpdate,
  CalendarLayerOut,
  CalendarLayerUpdate,
  HubPreferences,
  ScheduleComparisonOut,
} from '@docket/types';
import type { Page } from '@playwright/test';

import { CALENDAR_IDS, makeCalendarItem } from './calendar-fixtures';

/** One observed core-field update, retained for exact mutation assertions. */
export interface CalendarItemPatchRecord {
  readonly itemId: string;
  readonly patch: CalendarItemUpdate;
}

/** One observed task-link write, including the calendar target encoded in the route. */
export interface CalendarTaskLinkPostRecord {
  readonly itemId: string;
  readonly input: CalendarItemTaskLinkCreateType;
}

/** One observed calendar relationship write, including its directed source route. */
export interface CalendarRelationPostRecord {
  readonly itemId: string;
  readonly input: CalendarItemRelationCreateType;
}

/** Mutable state shared between route handlers and one test. */
export interface CalendarRouteState {
  layers: CalendarLayerOut[];
  items: CalendarItemOut[];
  relations: CalendarItemRelationOut[];
  preferences?: HubPreferences;
  nextCreatedItemId?: CalendarItemOut['id'];
  rangeFailure?: { readonly status: number; readonly body: unknown };
  agendaResponse?: AgendaOut;
  agendaFailure?: { readonly status: number; readonly body: unknown };
  comparisonResponse?: ScheduleComparisonOut;
  readonly itemCreates: CalendarItemCreateType[];
  readonly itemPatches: CalendarItemPatchRecord[];
  readonly taskLinkPosts: CalendarTaskLinkPostRecord[];
  readonly relationGets: string[];
  readonly ownedItemGets: string[];
  readonly relationPosts: CalendarRelationPostRecord[];
  readonly preferencePatches: HubPreferences[];
  readonly rangeRequests: string[];
}

/** Create observable route state with empty request journals. */
export function calendarRouteState(
  initial: Pick<CalendarRouteState, 'items' | 'layers'> &
    Partial<
      Pick<
        CalendarRouteState,
        | 'agendaFailure'
        | 'agendaResponse'
        | 'comparisonResponse'
        | 'nextCreatedItemId'
        | 'preferences'
        | 'rangeFailure'
        | 'relations'
      >
    >,
): CalendarRouteState {
  return {
    ...initial,
    relations: initial.relations ?? [],
    itemCreates: [],
    itemPatches: [],
    taskLinkPosts: [],
    relationGets: [],
    ownedItemGets: [],
    relationPosts: [],
    preferencePatches: [],
    rangeRequests: [],
  };
}

/** Install the legacy Agenda projection only when a test needs an explicit response boundary. */
async function installAgendaRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  if (!state.agendaResponse && !state.agendaFailure) return;
  await page.route('**/v1/agenda?**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    if (state.agendaFailure) {
      const { body, status } = state.agendaFailure;
      await route.fulfill(
        typeof body === 'string'
          ? { status, body, contentType: 'text/plain' }
          : { status, json: body },
      );
      return;
    }
    const response = state.agendaResponse;
    if (!response) return route.fallback();
    const requestedDate = new URL(request.url()).searchParams.get('date') ?? response.date;
    await route.fulfill({ json: { ...response, date: requestedDate } });
  });
}

/** Install preferences GET/PATCH fixtures while retaining every persisted scalar. */
async function installPreferenceRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  if (!state.preferences) return;
  await page.route('**/v1/hub/preferences', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: state.preferences });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as HubPreferences;
      state.preferencePatches.push(patch);
      state.preferences = {
        ...state.preferences,
        ...patch,
        ...(patch.calendar
          ? { calendar: { ...state.preferences?.calendar, ...patch.calendar } }
          : {}),
      };
      await route.fulfill({ json: state.preferences });
      return;
    }
    await route.fallback();
  });
}

/** Install layer list and visibility update fixtures. */
async function installLayerRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await page.route('**/v1/me/calendar/layers', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { items: state.layers } });
  });
  await page.route('**/v1/me/calendar/layers/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const itemId = new URL(route.request().url()).pathname.split('/').pop();
    const patch = route.request().postDataJSON() as CalendarLayerUpdate;
    const layer = state.layers.find((candidate) => candidate.id === itemId);
    if (!layer) {
      await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
      return;
    }
    Object.assign(layer, patch);
    await route.fulfill({ json: layer });
  });
}

/** Install range reads and native item creation. */
async function installCollectionRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await page.route('**/v1/me/calendar/items?**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.rangeRequests.push(route.request().url());
    if (state.rangeFailure) {
      await route.fulfill({ status: state.rangeFailure.status, json: state.rangeFailure.body });
      return;
    }
    const selectedLayerIds = new Set(
      state.layers.filter((layer) => layer.selected).map((layer) => layer.id),
    );
    await route.fulfill({
      json: {
        layers: state.layers.filter((layer) => selectedLayerIds.has(layer.id)),
        items: state.items.filter((item) => selectedLayerIds.has(item.layerId)),
      },
    });
  });
  await page.route('**/v1/me/calendar/items', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = CalendarItemCreate.parse(route.request().postDataJSON());
    state.itemCreates.push(input);
    const created = makeCalendarItem({
      id: state.nextCreatedItemId ?? CALENDAR_IDS.createdNativeItem,
      layerId: input.layerId ?? state.layers[0]?.id ?? CALENDAR_IDS.nativeLayer,
      kind:
        'kind' in input && input.kind === 'native_block'
          ? 'native_block'
          : input.intent === 'timebox'
            ? 'timebox'
            : 'native_event',
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      allDayStartDate: input.allDayStartDate ?? null,
      allDayEndDate: input.allDayEndDate ?? null,
    });
    state.items.push(created);
    await route.fulfill({ json: created });
  });
}

/** Install explicit relation reads/writes and retain their directed request payloads. */
async function installRelationRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await page.route('**/v1/me/calendar/items/*/relations', async (route) => {
    const request = route.request();
    const itemId = new URL(request.url()).pathname.split('/items/')[1]?.split('/relations')[0];
    if (!itemId) return route.fallback();
    if (request.method() === 'GET') {
      state.relationGets.push(itemId);
      await route.fulfill({
        json: { items: state.relations.filter((relation) => relation.sourceItemId === itemId) },
      });
      return;
    }
    if (request.method() === 'POST') {
      const input = CalendarItemRelationCreate.parse(request.postDataJSON());
      state.relationPosts.push({ itemId, input });
      const target = state.items.find((item) => item.id === input.targetItemId);
      const relation: CalendarItemRelationOut = {
        sourceItemId: itemId,
        targetItemId: input.targetItemId,
        ...(target ? { targetTitle: target.title, targetKind: target.kind } : {}),
        role: input.role,
        createdByUserId: 'e2e-calendar-user',
        createdAt: '2026-07-13T17:00:00.000Z',
      };
      state.relations.push(relation);
      await route.fulfill({ json: relation });
      return;
    }
    await route.fallback();
  });
}

/** Install item detail/update/delete reads. */
async function installDetailRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await page.route('**/v1/me/calendar/items/*', async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split('/items/')[1]?.split('/') ?? [];
    const [itemId, child] = parts;
    if (child) return route.fallback();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (request.method() === 'GET') {
      state.ownedItemGets.push(itemId ?? '');
      await route.fulfill(item ? { json: item } : { status: 404, json: { code: 'NOT_FOUND' } });
      return;
    }
    if (request.method() === 'PATCH') {
      if (!item) {
        await route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
        return;
      }
      const patch = request.postDataJSON() as CalendarItemUpdate;
      state.itemPatches.push({ itemId: item.id, patch });
      Object.assign(item, patch);
      await route.fulfill({ json: item });
      return;
    }
    if (request.method() === 'DELETE') {
      const index = state.items.findIndex((candidate) => candidate.id === itemId);
      const [removed] = index >= 0 ? state.items.splice(index, 1) : [];
      await route.fulfill({ json: removed ?? { id: itemId } });
      return;
    }
    await route.fallback();
  });
}

/** Install one permission-filtered people-comparison response when a browser contract needs it. */
async function installComparisonRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  if (!state.comparisonResponse) return;
  await page.route('**/v1/orgs/*/calendar/schedules?**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: state.comparisonResponse });
  });
}

/** Install create-and-link and link-existing task fixtures for the drawer contract. */
async function installTaskRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await page.route('**/v1/me/calendar/items/*/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const itemId = route.request().url().split('/items/')[1]?.split('/tasks')[0];
    const item = state.items.find((candidate) => candidate.id === itemId);
    const input = CalendarItemTaskLinkCreate.parse(route.request().postDataJSON());
    state.taskLinkPosts.push({ itemId: itemId ?? '', input });
    const taskId = input.mode === 'link' ? input.taskId : CALENDAR_IDS.createdTask;
    const title = input.mode === 'create' ? (input.title ?? 'New task') : 'Existing task';
    const link = {
      taskId,
      organizationId: input.organizationId,
      role: input.role ?? 'related',
      sort: item?.linkedTasks.length ?? 0,
      note: input.note ?? null,
      title,
      state: 'backlog',
      done: false,
    } satisfies CalendarItemOut['linkedTasks'][number];
    if (item) item.linkedTasks = [...item.linkedTasks, link];
    await route.fulfill({ json: { link, task: { id: taskId, title, state: 'backlog' } } });
  });
}

/** Install all browser-network boundaries needed by calendar page and drawer tests. */
export async function installCalendarRoutes(page: Page, state: CalendarRouteState): Promise<void> {
  await installAgendaRoutes(page, state);
  await installPreferenceRoutes(page, state);
  await installLayerRoutes(page, state);
  await installCollectionRoutes(page, state);
  await installComparisonRoutes(page, state);
  await installRelationRoutes(page, state);
  await installDetailRoutes(page, state);
  await installTaskRoutes(page, state);
}
