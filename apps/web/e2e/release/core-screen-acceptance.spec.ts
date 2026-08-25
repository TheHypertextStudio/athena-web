import type { BrowserContext, Page, Response } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

interface ScreenCase {
  readonly name: string;
  readonly href: string;
  readonly surface?: 'dialog' | 'main';
}

interface DetailCase extends ScreenCase {
  readonly aggregatePath: string;
  readonly loadedControl: {
    readonly name: string;
    readonly role: 'heading' | 'textbox';
  };
}

const FAILURE_COPY =
  /Couldn[’']t load this page|Page unavailable|Something went wrong|Could not (?:load|refresh)/iu;

/** Return whether an API response proves that the current screen failed to load. */
function isCriticalFailure(response: Response): boolean {
  const url = new URL(response.url());
  const status = response.status();
  // The local test account has no paid integration entitlement. Those endpoints deliberately
  // answer 402 while the screen renders its available state, so 402 is the one non-success status
  // that does not prove a broken screen.
  const missingOptionalDefault =
    status === 404 &&
    /\/work-views\/defaults\/(?:task|project|program|initiative)$/u.test(url.pathname);
  return (
    url.pathname.startsWith('/v1/') && status >= 400 && status !== 402 && !missingOptionalDefault
  );
}

/** Require one isolated authenticated screen to settle into a usable, non-empty main surface. */
async function expectAcceptableScreen(context: BrowserContext, screen: ScreenCase): Promise<void> {
  const page = await context.newPage();
  const failedResponses: string[] = [];
  const runtimeErrors: string[] = [];
  const aggregateResponses: Response[] = [];
  const onResponse = (response: Response): void => {
    if ('aggregatePath' in screen && new URL(response.url()).pathname === screen.aggregatePath) {
      aggregateResponses.push(response);
    }
    if (isCriticalFailure(response)) {
      failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  };
  const onPageError = (error: Error): void => {
    runtimeErrors.push(error.name);
  };
  page.on('response', onResponse);
  page.on('pageerror', onPageError);

  try {
    const response = await page.goto(screen.href, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.pageReady,
    });
    expect(response?.ok(), `${screen.name} document should load`).toBe(true);

    const surface =
      screen.surface === 'dialog'
        ? page.getByRole('dialog').first()
        : page.getByRole('main').first();
    await expect(surface, `${screen.name} should render its primary surface`).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    if ('loadedControl' in screen) {
      await expect(
        page.getByRole(screen.loadedControl.role, { name: screen.loadedControl.name }).first(),
        `${screen.name} should replace the navigation snapshot with its full detail surface`,
      ).toBeVisible({ timeout: TIMEOUTS.ui });
    }
    await expect(
      surface,
      `${screen.name} should not render a whole-page failure`,
    ).not.toContainText(FAILURE_COPY);
    await expect(
      page.getByText('Syncing…', { exact: true }),
      `${screen.name} should finish its initial reconciliation`,
    ).toHaveCount(0, { timeout: TIMEOUTS.ui });
    await expect
      .poll(
        async () => {
          const geometry = await surface.evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            textLength: element.textContent.trim().length,
            width: element.getBoundingClientRect().width,
          }));
          return geometry.width > 300 && geometry.height > 300 && geometry.textLength > 10;
        },
        { message: `${screen.name} should render visible content`, timeout: TIMEOUTS.ui },
      )
      .toBe(true);

    const geometry = await surface.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      textLength: element.textContent.trim().length,
      width: element.getBoundingClientRect().width,
    }));
    expect(geometry.width, `${screen.name} main surface should have usable width`).toBeGreaterThan(
      300,
    );
    expect(
      geometry.height,
      `${screen.name} main surface should have usable height`,
    ).toBeGreaterThan(300);
    expect(geometry.textLength, `${screen.name} main surface should not be blank`).toBeGreaterThan(
      10,
    );

    expect(runtimeErrors, `${screen.name} should not throw in the browser`).toEqual([]);
    expect(failedResponses, `${screen.name} should not receive a failed API response`).toEqual([]);
    if ('aggregatePath' in screen) {
      expect(
        aggregateResponses.length,
        `${screen.name} should not duplicate its server-hydrated aggregate`,
      ).toBeLessThanOrEqual(1);
      if (aggregateResponses[0] !== undefined) {
        expect(
          aggregateResponses[0].status(),
          `${screen.name} client reconciliation should pass its response contract`,
        ).toBe(200);
      }
    }
  } finally {
    page.off('response', onResponse);
    page.off('pageerror', onPageError);
    await page.close();
  }
}

/** Create one representative record for every local-first detail kind. */
async function seedDetails(
  page: Page,
  orgId: string,
): Promise<{ initiativeId: string; programId: string; projectId: string; taskId: string }> {
  const teams = await apiJson<{ items: readonly { id: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding did not create a Team.');

  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Screen acceptance initiative' },
  });
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: { name: 'Screen acceptance program' },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Screen acceptance project', teamId },
  });
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Screen acceptance task', teamId, projectId: project.id },
  });

  return {
    initiativeId: initiative.id,
    programId: program.id,
    projectId: project.id,
    taskId: task.id,
  };
}

test('every primary authenticated screen and local-first detail settles', async ({ page }) => {
  test.setTimeout(300_000);
  const { orgId } = await signUpAndOnboard(page, 'CoreScreenAcceptance');
  const ids = await seedDetails(page, orgId);
  const context = page.context();
  await page.close();

  const primaryScreens: readonly ScreenCase[] = [
    { name: 'Today', href: '/today' },
    { name: 'Tasks', href: '/tasks' },
    { name: 'Calendar', href: '/calendar' },
    { name: 'Inbox', href: '/inbox' },
    { name: 'Athena', href: '/athena' },
    { name: 'Stream', href: '/stream' },
    { name: 'Portfolio', href: '/portfolio' },
    { name: 'Search', href: '/search' },
    { name: 'My Work', href: orgHref(orgId, 'my-work') },
    { name: 'Triage', href: orgHref(orgId, 'triage') },
    { name: 'Workspace Tasks', href: orgHref(orgId, 'tasks') },
    { name: 'Workspace Stream', href: orgHref(orgId, 'stream') },
    { name: 'Library', href: orgHref(orgId, 'library') },
    { name: 'Initiatives', href: orgHref(orgId, 'initiatives') },
    { name: 'Programs', href: orgHref(orgId, 'programs') },
    { name: 'Projects', href: orgHref(orgId, 'projects') },
    { name: 'Cycles', href: orgHref(orgId, 'cycles') },
    { name: 'Teams', href: orgHref(orgId, 'teams') },
    { name: 'People', href: orgHref(orgId, 'people') },
    { name: 'Views', href: orgHref(orgId, 'views') },
    { name: 'Graph', href: orgHref(orgId, 'graph') },
    { name: 'Settings', href: orgHref(orgId, 'settings'), surface: 'dialog' },
  ];

  for (const screen of primaryScreens) await expectAcceptableScreen(context, screen);

  const details: readonly DetailCase[] = [
    {
      name: 'Task detail',
      href: orgHref(orgId, `tasks/${ids.taskId}`),
      aggregatePath: `/v1/orgs/${orgId}/tasks/${ids.taskId}/aggregate-detail`,
      loadedControl: { role: 'heading', name: 'Screen acceptance task' },
    },
    {
      name: 'Project detail',
      href: orgHref(orgId, `projects/${ids.projectId}`),
      aggregatePath: `/v1/orgs/${orgId}/projects/${ids.projectId}/aggregate-detail`,
      loadedControl: { role: 'textbox', name: 'Project name' },
    },
    {
      name: 'Program detail',
      href: orgHref(orgId, `programs/${ids.programId}`),
      aggregatePath: `/v1/orgs/${orgId}/programs/${ids.programId}/aggregate-detail`,
      loadedControl: { role: 'textbox', name: 'Program name' },
    },
    {
      name: 'Initiative detail',
      href: orgHref(orgId, `initiatives/${ids.initiativeId}`),
      aggregatePath: `/v1/orgs/${orgId}/initiatives/${ids.initiativeId}/aggregate-detail`,
      loadedControl: { role: 'textbox', name: 'Initiative name' },
    },
  ];

  for (const detail of details) {
    await expectAcceptableScreen(context, detail);
  }
});
