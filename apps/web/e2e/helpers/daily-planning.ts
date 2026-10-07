/** Authenticated daily-planning fixtures and browser actions. */
import { addDays, instantAt, localMinuteOfDay } from '@docket/planning/zoned-time';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { signUpAndOnboard } from './app';
import { expect } from './fixtures';
import { apiJson } from './net';

/** Selected work and local dates returned by authenticated fixture setup. */
export interface PlanningContext {
  orgId: string;
  timezone: string;
  date: string;
  taskIds: string[];
  itemIds: string[];
}

const TEST_TIMEZONES = [
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
];
/** Choose a timezone where the current clock falls inside the requested test window. */
export function planningTimezone(fromMinute = 10 * 60, throughMinute = 13 * 60): string {
  const zone = TEST_TIMEZONES.find((timezone) => {
    const minute = localMinuteOfDay(new Date(), timezone);
    return minute >= fromMinute && minute <= throughMinute;
  });
  if (!zone) throw new Error('No test timezone has a local time inside the requested window.');
  return zone;
}
/** Saved planning state observed through the authenticated API. */
export interface DayRead {
  revision: number;
  draft: DailyPlanSnapshot | null;
  accepted: {
    original: { snapshot: DailyPlanSnapshot };
    current: { snapshot: DailyPlanSnapshot };
    history: unknown[];
  } | null;
  actual: { taskId: string | null; recordedMinutes: number }[];
}
/** Create an authenticated day with explicitly selected tasks. */
export async function setupPlan(
  page: Page,
  label: string,
  titles: readonly string[],
  offset = 0,
  timezone = planningTimezone(),
): Promise<PlanningContext> {
  const { orgId } = await signUpAndOnboard(page, label);
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone } });
  const date = addDays(new Date().toLocaleDateString('en-CA', { timeZone: timezone }), offset);
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const taskIds: string[] = [];
  const itemIds: string[] = [];
  for (const title of titles) {
    const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId: teams.items[0]?.id },
    });
    const item = await apiJson<{ id: string }>(page, '/v1/daily-plan', {
      method: 'POST',
      body: { refOrganizationId: orgId, refTaskId: task.id, date },
    });
    taskIds.push(task.id);
    itemIds.push(item.id);
  }
  return { orgId, timezone, date, taskIds, itemIds };
}
/** Build accepted-intent fixtures using exact local session times. */
export function snapshot(
  context: Awaited<ReturnType<typeof setupPlan>>,
  minutes: readonly number[],
  sessions: DailyPlanSnapshot['sessions'],
): DailyPlanSnapshot {
  return {
    date: context.date,
    mainTaskId: null,
    finishAt: instantAt(context.date, 17 * 60, context.timezone).toISOString(),
    tasks: context.taskIds.map((taskId, sort) => ({
      taskId,
      organizationId: context.orgId,
      plannedMinutes: minutes[sort] ?? 45,
      sort,
    })),
    sessions,
  };
}
/** Save fixtures through revision-guarded production persistence. */
export async function saveDraft(
  page: Page,
  draft: DailyPlanSnapshot,
  resumeStep = 'plan_today',
): Promise<void> {
  const day = await apiJson<DayRead>(page, `/v1/daily-plan/day/${draft.date}`);
  await apiJson(page, `/v1/daily-plan/day/${draft.date}/draft`, {
    method: 'PUT',
    body: { draft, resumeStep, expectedRevision: day.revision },
  });
}
/** Open and apply the initial proposed schedule before editing. */
export async function openPlan(page: Page, date: string): Promise<void> {
  await page.goto(`/plan?view=day&date=${date}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /^Plan (today|tomorrow|day)$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Organize day', exact: true })).toBeEnabled();
  const apply = page.getByRole('button', { name: 'Apply schedule', exact: true });
  if (await apply.isVisible()) await apply.click();
}
/** Persist the visible draft and move to the shared review stage. */
export async function reviewPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review plan', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Review plan', exact: true })).toBeVisible();
}
/** Drag through the same activation and drop targets used by a pointer. */
export async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  await target.scrollIntoViewIfNeeded();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('The drag source and target must be visible.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 4, { steps: 12 });
  await page.mouse.up();
}

/** Verify the measured hitbox of a control on the touch planning surface. */
export async function assertPlanningTouchTarget(control: Locator): Promise<void> {
  const bounds = await control.boundingBox();
  expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(40);
  expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(40);
}

/** Verify keyboard focus reaches a control and paints a visible indicator. */
export async function assertPlanningKeyboardFocus(page: Page, control: Locator): Promise<void> {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  const focus = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
      shadow: style.boxShadow,
    };
  });
  expect(focus.visible).toBe(true);
  expect(
    (focus.outlineWidth > 0 &&
      focus.outlineStyle !== 'none' &&
      focus.outlineColor !== 'rgba(0, 0, 0, 0)') ||
      focus.shadow !== 'none',
  ).toBe(true);
}

/** Verify rendered animation and transition times honor reduced motion. */
export async function assertPlanningReducedMotion(control: Locator): Promise<void> {
  const durations = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return [...style.transitionDuration.split(','), ...style.animationDuration.split(',')].map(
      (value) => Number.parseFloat(value),
    );
  });
  expect(Math.max(...durations)).toBeLessThanOrEqual(0.000011);
}

/** Edit work through measured touch controls, with keyboard focus and reduced-motion checks. */
export async function editPlanningTouchWork(
  page: Page,
  title: string,
  minutes: string,
): Promise<void> {
  const schedule = page.getByRole('button', { name: `Schedule ${title}`, exact: true });
  for (const control of [
    schedule,
    page.getByRole('button', { name: `Drag ${title} to reorder or schedule` }),
    page.getByRole('textbox', { name: `Task title: ${title}` }),
    page.getByRole('spinbutton', { name: `Planned time for ${title}` }),
    page.getByRole('button', { name: `Actions for ${title}` }),
  ])
    await assertPlanningTouchTarget(control);
  await assertPlanningKeyboardFocus(page, schedule);
  await assertPlanningReducedMotion(schedule);
  await schedule.tap();
  await expect(page.getByRole('dialog', { name: 'Edit block' })).toBeVisible();
  await page.getByRole('spinbutton', { name: `Duration for ${title}` }).fill(minutes);
  await assertPlanningReducedMotion(page.getByRole('dialog', { name: 'Edit block' }));
  const saveBlock = page.getByRole('button', { name: 'Save block', exact: true });
  await assertPlanningTouchTarget(saveBlock);
  await saveBlock.tap();
}

/** Confirm through the measured phone actions while leaving tracking idle. */
export async function confirmPlanningTouchPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review plan', exact: true }).last().tap();
  const confirm = page.getByRole('button', { name: 'Confirm plan', exact: true });
  await assertPlanningTouchTarget(confirm);
  await confirm.tap();
  await expect(page.getByRole('heading', { name: 'Your plan is set' })).toBeVisible();
  expect((await apiJson<{ record: unknown }>(page, '/v1/time/active')).record).toBeNull();
}

async function assertPlanningEvidenceStage(page: Page, stage: string): Promise<void> {
  const headings: Record<string, string> = {
    plan: 'Plan today',
    review: 'Review plan',
    confirmation: 'Your plan is set',
    today: 'Today',
    'add-work': 'Add work',
    yesterday: 'Review yesterday',
    revision: 'Plan updated',
    'revision-preview': 'Review plan',
    'short-blocks-plan': 'Plan today',
    'short-blocks-review': 'Review plan',
    'short-blocks-today': 'Today',
  };
  const heading = headings[stage];
  if (!heading) throw new Error(`Unknown planning evidence stage: ${stage}`);
  const pathname = stage.endsWith('today') ? '/today' : '/plan';
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
  const stageHeading = page.getByRole('heading', {
    name: heading,
    exact: true,
    includeHidden: true,
  });
  await expect(stageHeading).toBeVisible();
  if (!stage.startsWith('short-blocks-')) {
    await stageHeading.evaluate((element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        ancestor.scrollTop = 0;
        ancestor = ancestor.parentElement;
      }
      window.scrollTo(0, 0);
    });
  }
}

/** Capture authenticated planning evidence at four viewport sizes in both themes. */
export async function captureDailyPlanningEvidence(
  page: Page,
  testInfo: TestInfo,
  stage: string,
  verifyFrame?: () => Promise<void>,
): Promise<void> {
  if (process.env['E2E_EVIDENCE'] !== '1') return;
  const originalViewport = page.viewportSize();
  const originalScheme = await page.evaluate(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 844 },
      { width: 390, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await verifyFrame?.();
        await assertPlanningEvidenceStage(page, stage);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(page.locator('[data-toast-tone="critical"]:visible')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(
            `${stage}-${viewport.width}x${viewport.height}-${colorScheme}.png`,
          ),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
    await page.emulateMedia({ colorScheme: originalScheme });
  }
}

/** Verify proportional geometry and capture it through the shared evidence matrix. */
export async function captureShortBlockEvidence(
  page: Page,
  testInfo: TestInfo,
  stage: 'plan' | 'review' | 'today',
  itemId: string,
  height: string,
): Promise<void> {
  const verifyFrame = async (): Promise<void> => {
    if (stage === 'today') {
      const close = page.getByRole('button', { name: 'Close Agenda', exact: true });
      if ((page.viewportSize()?.width ?? 0) >= 1280 && (await close.isVisible()))
        await close.click();
      const show = page.getByRole('button', { name: 'Show Agenda', exact: true });
      if (await show.isVisible()) await show.click();
    }
    const agenda =
      stage === 'today'
        ? (page.viewportSize()?.width ?? 0) >= 1280
          ? page.locator('#shell-aside')
          : page.getByRole('dialog', { name: 'Agenda', exact: true })
        : page;
    const block = agenda.locator(`[data-schedule-item="${itemId}"]`);
    await expect(block).toHaveCSS('height', height);
    await block.scrollIntoViewIfNeeded();
  };
  await verifyFrame();
  await captureDailyPlanningEvidence(page, testInfo, `short-blocks-${stage}`, verifyFrame);
}
