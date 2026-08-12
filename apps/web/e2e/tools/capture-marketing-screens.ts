/**
 * Capture the nine real Docket views embedded by the marketing home page.
 *
 * @remarks
 * This is intentionally a product flow, not a screenshot compositor. It creates a disposable
 * passkey account, writes plausible work through Docket's HTTP API, completes a real MCP OAuth
 * consent, opens the corresponding application routes, and photographs what the product renders.
 * The committed JPEGs contain no customer data and are labeled as example data by the marketing
 * frame that displays them.
 *
 * Run against a local stack:
 * `APP_URL=http://docket.localhost:4200 API_URL=http://api.docket.localhost:4100 PASSKEY_RP_ID=docket.localhost pnpm --filter @docket/web exec tsx e2e/tools/capture-marketing-screens.ts`
 *
 * The Docket hostname is load-bearing: Better Auth scopes its signed WebAuthn challenge cookie to
 * `docket.localhost`, so running the browser at bare `localhost` makes verification correctly fail
 * with `CHALLENGE_NOT_FOUND`.
 */
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { authorizeInBrowser, discover, exchangeCode, registerClient } from '../helpers/mcp';
import { apiJson } from '../helpers/net';
import { addVirtualAuthenticator } from '../helpers/webauthn';

const CAPTURE_NOW = new Date('2026-08-11T17:00:00.000Z');
const DAY = '2026-08-11';
const OUTPUT = resolve(process.cwd(), 'public/marketing');
const PUBLIC_MCP_URL = 'https://docket-api.hypertext.studio/mcp';

interface OrgSeed {
  readonly id: string;
  readonly teamId: string;
  readonly ownerActorId: string;
}

interface WorkSeed {
  readonly programId: string;
  readonly initiativeId: string;
  readonly primaryProjectId: string;
  readonly primaryTaskId: string;
  readonly tasks: readonly string[];
}

interface WorkSeedCopy {
  readonly program: string;
  readonly programSummary: string;
  readonly programDescription: string;
  readonly initiative: string;
  readonly initiativeSummary: string;
  readonly initiativeDescription: string;
  readonly project: string;
  readonly projectSummary: string;
  readonly secondProject: string;
  readonly secondProjectSummary: string;
  readonly tasks: readonly [string, string, string, string];
  readonly taskDescriptions: readonly [string, string, string, string];
}

interface OrgCreateResult {
  readonly organization: { readonly id: string };
  readonly defaultTeam: { readonly id: string };
  readonly ownerActorId: string;
}

/** Convert a Pacific wall-clock time on the fixed capture day into UTC. */
function at(hour: number, minute = 0): string {
  return new Date(
    `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-07:00`,
  ).toISOString();
}

/** Wait until a route has real content and no loading skeletons before photographing it. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0);
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForFunction(
    () =>
      !/\bLoading(?: your)? [^\n]*…/i.test(document.body.innerText) &&
      document.querySelector('.animate-pulse') === null,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(750);
}

/** Open an authenticated product route and save the viewport as a high-quality JPEG. */
async function capture(
  page: Page,
  path: string,
  file: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/sign-in')) throw new Error(`${path} redirected to sign-in`);
  await settle(page);
  if (prepare) {
    await prepare(page);
    await settle(page);
  }
  // The development server's issue badge is not part of Docket and is absent from production.
  await page.locator('nextjs-portal').evaluateAll((elements) => {
    for (const element of elements) element.remove();
  });
  await page.screenshot({
    path: resolve(OUTPUT, file),
    type: 'jpeg',
    quality: 91,
    animations: 'disabled',
  });
  console.log(`[marketing-capture] ${file} ← ${path}`);
}

/** Resolve the personal workspace's seeded team and human actor. */
async function personalSeed(page: Page, organizationId: string): Promise<OrgSeed> {
  const [teams, members] = await Promise.all([
    apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${organizationId}/teams`),
    apiJson<{ items: { actorId: string }[] }>(page, `/v1/orgs/${organizationId}/members`),
  ]);
  const teamId = teams.items[0]?.id;
  const ownerActorId = members.items[0]?.actorId;
  if (!teamId || !ownerActorId) throw new Error('Personal workspace baseline is incomplete');
  return { id: organizationId, teamId, ownerActorId };
}

/** Create a shared organization through the same endpoint used by the product. */
async function createOrganization(page: Page, name: string, purpose: string): Promise<OrgSeed> {
  const result = await apiJson<OrgCreateResult>(page, '/v1/orgs', {
    method: 'POST',
    body: { name, purpose, vocabulary: 'startup', isPersonal: false },
  });
  return {
    id: result.organization.id,
    teamId: result.defaultTeam.id,
    ownerActorId: result.ownerActorId,
  };
}

/** Create one coherent program, initiative, project set, and task list in an organization. */
async function seedWork(page: Page, org: OrgSeed, names: WorkSeedCopy): Promise<WorkSeed> {
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${org.id}/programs`, {
    method: 'POST',
    body: {
      name: names.program,
      summary: names.programSummary,
      description: names.programDescription,
      ownerId: org.ownerActorId,
      health: 'on_track',
    },
  });
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${org.id}/initiatives`, {
    method: 'POST',
    body: {
      name: names.initiative,
      summary: names.initiativeSummary,
      description: names.initiativeDescription,
      ownerId: org.ownerActorId,
      status: 'active',
      priority: 'high',
      health: 'on_track',
      targetDate: '2026-09-30',
    },
  });
  const primaryProject = await apiJson<{ id: string }>(page, `/v1/orgs/${org.id}/projects`, {
    method: 'POST',
    body: {
      name: names.project,
      summary: names.projectSummary,
      description: names.projectSummary,
      leadId: org.ownerActorId,
      teamId: org.teamId,
      programId: program.id,
      initiativeIds: [initiative.id],
      status: 'active',
      health: 'on_track',
      startDate: '2026-08-03',
      targetDate: '2026-09-12',
    },
  });
  await apiJson(page, `/v1/orgs/${org.id}/projects`, {
    method: 'POST',
    body: {
      name: names.secondProject,
      summary: names.secondProjectSummary,
      description: names.secondProjectSummary,
      leadId: org.ownerActorId,
      teamId: org.teamId,
      programId: program.id,
      initiativeIds: [initiative.id],
      status: 'planned',
      health: 'at_risk',
      startDate: '2026-08-18',
      targetDate: '2026-09-26',
    },
  });

  const taskBodies = [
    {
      title: names.tasks[0],
      state: 'in_progress',
      priority: 'high',
      estimateMinutes: 90,
      startDate: DAY,
      dueDate: DAY,
    },
    {
      title: names.tasks[1],
      state: 'todo',
      priority: 'medium',
      estimateMinutes: 45,
      startDate: DAY,
      dueDate: '2026-08-13',
    },
    {
      title: names.tasks[2],
      state: 'backlog',
      priority: 'low',
      estimateMinutes: 30,
      dueDate: '2026-08-18',
    },
    {
      title: names.tasks[3],
      state: 'done',
      priority: 'medium',
      estimateMinutes: 60,
      startDate: '2026-08-08',
      dueDate: DAY,
    },
  ] as const;
  const tasks: string[] = [];
  for (const [index, body] of taskBodies.entries()) {
    const created = await apiJson<{ id: string }>(page, `/v1/orgs/${org.id}/tasks`, {
      method: 'POST',
      body: {
        ...body,
        teamId: org.teamId,
        projectId: primaryProject.id,
        assigneeId: org.ownerActorId,
        description: names.taskDescriptions[index],
      },
    });
    tasks.push(created.id);
  }
  const primaryTaskId = tasks[0];
  if (!primaryTaskId) throw new Error('Primary task was not created');
  return {
    programId: program.id,
    initiativeId: initiative.id,
    primaryProjectId: primaryProject.id,
    primaryTaskId,
    tasks,
  };
}

/** Populate the task-detail capture with real child work and a useful external reference. */
async function seedTaskContext(page: Page, org: OrgSeed, work: WorkSeed): Promise<void> {
  for (const body of [
    {
      title: 'Mark school holidays and conference dates',
      description: 'Copy the confirmed dates into the shared calendar and note each travel day.',
      state: 'done',
      priority: 'medium',
      assigneeId: org.ownerActorId,
      estimateMinutes: 25,
    },
    {
      title: 'Add hotel cancellation deadlines',
      description: 'Record the last refundable day beside each reservation.',
      state: 'todo',
      priority: 'high',
      assigneeId: org.ownerActorId,
      estimateMinutes: 20,
    },
  ] as const) {
    await apiJson(page, `/v1/orgs/${org.id}/tasks/${work.primaryTaskId}/subtasks`, {
      method: 'POST',
      body,
    });
  }

  await apiJson(page, `/v1/orgs/${org.id}/tasks/${work.primaryTaskId}/attachments`, {
    method: 'POST',
    body: {
      kind: 'url',
      title: 'Amtrak route schedules',
      url: 'https://www.amtrak.com/train-schedules-timetables',
    },
  });
}

/** Add selected tasks to Today and record actual historical time against two of them. */
async function seedPersonalPlanning(
  page: Page,
  planned: readonly { readonly orgId: string; readonly taskId: string; readonly hour: number }[],
): Promise<void> {
  for (const item of planned) {
    await apiJson(page, '/v1/daily-plan', {
      method: 'POST',
      body: {
        refOrganizationId: item.orgId,
        refTaskId: item.taskId,
        date: DAY,
        timeboxStartsAt: at(item.hour),
        timeboxEndsAt: at(item.hour + 1),
      },
    });
  }

  for (const item of planned.slice(0, 2)) {
    await apiJson(page, '/v1/time/records', {
      method: 'POST',
      body: {
        context: { taskId: item.taskId, organizationId: item.orgId, contextualRefs: [] },
        captureSource: 'manual',
        startNow: false,
        startsAt: at(item.hour - 1),
        endsAt: at(item.hour - 1, 40),
      },
    });
  }
}

/** Register and approve one real OAuth client so the roster is populated rather than staged. */
async function seedConnectedApp(page: Page): Promise<void> {
  const discovery = await discover();
  const clientId = await registerClient(discovery, 'Claude Desktop');
  const { code, codeVerifier } = await authorizeInBrowser(page, discovery, {
    clientId,
    scope: 'work:read work:write offline_access',
  });
  await exchangeCode(discovery, { clientId, code, codeVerifier });
}

/** Give the disposable owner a normal example name in account and workspace-owned identity rows. */
async function nameExampleOwner(page: Page, organizations: readonly OrgSeed[]): Promise<void> {
  await apiJson(page, '/v1/me/account/profile', {
    method: 'PATCH',
    body: { name: 'Alex Rivera' },
  });
  for (const organization of organizations) {
    await apiJson(
      page,
      `/v1/orgs/${organization.id}/members/${organization.ownerActorId}/profile`,
      {
        method: 'PATCH',
        body: { displayName: 'Alex Rivera', title: 'Director' },
      },
    );
  }
}

/** Create first-party calendar blocks through the real personal calendar endpoint. */
async function seedCalendar(page: Page): Promise<void> {
  for (const item of [
    { title: 'Review the service map', startsAt: at(10), endsAt: at(11) },
    { title: 'Volunteer briefing', startsAt: at(13), endsAt: at(14) },
    { title: 'Grant review panel', startsAt: at(15, 30), endsAt: at(16, 30) },
  ]) {
    await apiJson(page, '/v1/me/calendar/items', {
      method: 'POST',
      body: { ...item, intent: 'timebox', timezone: 'America/Los_Angeles' },
    });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: process.env['APP_URL'] ?? 'https://docket.localhost',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    timezoneId: 'America/Los_Angeles',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await addVirtualAuthenticator(page);

  const { orgId: personalId } = await signUpAndOnboard(page, {
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
  });
  // Better Auth's passkey ceremony uses the browser clock when validating its challenge. Freeze
  // the product data only after authentication, so the capture is deterministic without making
  // a valid server-issued challenge appear to come from the future or the past.
  await page.clock.setFixedTime(CAPTURE_NOW);
  await apiJson(page, `/v1/orgs/${personalId}`, {
    method: 'PATCH',
    body: { name: "Alex's Docket", purpose: 'Personal planning and time tracking.' },
  });
  const personal = await personalSeed(page, personalId);
  const civic = await createOrganization(
    page,
    'Civic Studio',
    'Public-interest research and community projects.',
  );
  const neighborhood = await createOrganization(
    page,
    'Neighborhood Fund',
    'Small grants and resident-led neighborhood improvements.',
  );
  await nameExampleOwner(page, [personal, civic, neighborhood]);

  const personalWork = await seedWork(page, personal, {
    program: 'Home and personal admin',
    programSummary: 'Keep household commitments, appointments, and travel plans current.',
    programDescription:
      'The ongoing work Alex reviews each Sunday: appointments, school dates, household errands, and travel logistics.',
    initiative: 'September reset',
    initiativeSummary: 'Set the family calendar and weekly routine before September begins.',
    initiativeDescription:
      'Confirm the fall travel dates, school schedule, recurring errands, and Sunday planning routine before Labor Day.',
    project: 'Plan the fall travel calendar',
    projectSummary:
      'Confirm every trip, reservation deadline, and family handoff through the end of November.',
    secondProject: 'Rebuild the weekly routine',
    secondProjectSummary:
      'Set a workable Sunday review and weekday rhythm before the school year starts.',
    tasks: [
      'Review the fall calendar',
      'Book the annual checkup',
      'Compare train times',
      'Send the family schedule',
    ],
    taskDescriptions: [
      'Check the confirmed trips, school dates, hotel deadlines, and family handoffs before booking the remaining train legs.',
      'Call the clinic and find a morning appointment before the September travel week.',
      'Compare the Coast Starlight and Cascades connections, including the overnight transfer.',
      'Send the confirmed September dates and pickup plan to Jordan and Maya.',
    ],
  });
  const civicWork = await seedWork(page, civic, {
    program: 'Community engagement',
    programSummary: 'Recruit, brief, and support volunteers for rider-facing events.',
    programDescription:
      'Civic Studio runs recurring volunteer briefings, open houses, and field research with transit riders.',
    initiative: 'Fall service campaign',
    initiativeSummary: 'Prepare riders and volunteers for the September service change.',
    initiativeDescription:
      'Publish a tested field guide, hold a public open house, and brief volunteers before the new schedules take effect.',
    project: 'Publish the rider field guide',
    projectSummary:
      'Test the route notes with volunteers, finish the maps, and publish before service changes.',
    secondProject: 'Host the September open house',
    secondProjectSummary:
      'Book the library room, recruit six volunteers, and prepare a bilingual welcome table.',
    tasks: [
      'Review the service map',
      'Confirm the volunteer briefing',
      'Prepare the survey cards',
      'Send partner notes',
    ],
    taskDescriptions: [
      'Check every stop label and transfer note against the August operator bulletin.',
      'Confirm the library room, interpretation, and six volunteer assignments for Thursday.',
      'Print 150 bilingual rider cards and bundle them by survey location.',
      'Send the route findings and three open questions to the agency planning team.',
    ],
  });
  const neighborhoodWork = await seedWork(page, neighborhood, {
    program: 'Resident grants',
    programSummary: 'Run small-grant rounds from application through award reporting.',
    programDescription:
      'Neighborhood Fund supports resident-led block projects with clear applications, review panels, and public award records.',
    initiative: 'Autumn grant round',
    initiativeSummary: 'Open applications and complete the first review panel by September 30.',
    initiativeDescription:
      'Publish the application, hold two office hours, recruit reviewers, and document award criteria for the autumn round.',
    project: 'Open the block improvement fund',
    projectSummary:
      'Publish a plain-language application and make the first decisions by the end of September.',
    secondProject: 'Document the summer grantees',
    secondProjectSummary:
      'Collect final photos and short reports from all twelve summer award recipients.',
    tasks: [
      'Check the application form',
      'Schedule the review panel',
      'Publish office hours',
      'Confirm the award criteria',
    ],
    taskDescriptions: [
      'Test the eligibility questions and make the budget section readable on a phone.',
      'Find a two-hour evening slot that works for all five resident reviewers.',
      'Post two drop-in sessions at the library and add them to the neighborhood calendar.',
      'Send the final scoring guide to reviewers and publish it beside the application.',
    ],
  });

  await seedTaskContext(page, personal, personalWork);

  await seedPersonalPlanning(page, [
    { orgId: personal.id, taskId: personalWork.primaryTaskId, hour: 8 },
    { orgId: civic.id, taskId: civicWork.primaryTaskId, hour: 10 },
    { orgId: neighborhood.id, taskId: neighborhoodWork.primaryTaskId, hour: 13 },
    { orgId: civic.id, taskId: civicWork.tasks[1] ?? civicWork.primaryTaskId, hour: 15 },
  ]);
  await seedCalendar(page);
  await seedConnectedApp(page);

  // A recovery reminder is useful in the product but unrelated to these product views. Dismiss it
  // through its real control once, exactly as the disposable account holder would.
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await settle(page);
  const recoveryDismiss = page.getByRole('button', { name: 'Dismiss' });
  if (await recoveryDismiss.isVisible()) await recoveryDismiss.click();

  await capture(page, '/today', 'today.jpg');
  await capture(
    page,
    `/orgs/${personal.id}/tasks/${personalWork.primaryTaskId}`,
    'task-detail.jpg',
  );
  await capture(
    page,
    `/orgs/${civic.id}/programs/${civicWork.programId}`,
    'program.jpg',
    async (programPage) => {
      await programPage.getByRole('tab', { name: /Projects/ }).click();
    },
  );
  await capture(page, `/orgs/${civic.id}/initiatives/${civicWork.initiativeId}`, 'initiative.jpg');
  await capture(page, `/orgs/${civic.id}/projects`, 'civic-studio.jpg');
  await capture(page, `/orgs/${neighborhood.id}/projects`, 'neighborhood-fund.jpg');
  await capture(page, '/portfolio', 'portfolio.jpg');
  await capture(page, '/calendar', 'calendar.jpg');

  // The capture stack is local, but the setup command pictured on the public site must use the
  // deployed resource URL. Override only the public config response for this final photograph;
  // the connected client and its grants were created against the real local OAuth server above.
  await page.route('**/v1/config', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...config, mcpUrl: PUBLIC_MCP_URL } });
  });
  await capture(page, '/settings/connected-apps', 'connected-apps.jpg', async (settingsPage) => {
    await settingsPage.locator('#mcp-client-select').selectOption('claude-desktop');
  });
  await page.unroute('**/v1/config');

  await browser.close();
}

main().catch((error: unknown) => {
  console.error('[marketing-capture] failed:', error);
  process.exit(1);
});
