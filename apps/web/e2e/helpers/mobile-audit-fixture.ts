import type { Page } from '@playwright/test';

import { apiJson } from './net';

/** Origins the local-only mobile audit fixture is allowed to use. */
export interface MobileAuditOrigins {
  readonly apiOrigin: string;
  readonly webOrigin: string;
}

/** Every local record that the screenshot and geometry matrix needs to open. */
export interface MobileAuditFixture {
  readonly orgId: string;
  readonly ownerActorId: string;
  readonly teamId: string;
  readonly personId: string;
  readonly initiativeId: string;
  readonly programId: string;
  readonly projectId: string;
  readonly blockingProjectId: string;
  readonly cycleId: string;
  readonly taskId: string;
  readonly recurrenceSeriesId: string;
  readonly recurringTaskId: string;
  readonly agentSessionId: string;
}

interface OrgCreateResult {
  readonly organization: { readonly id: string };
  readonly defaultTeam: { readonly id: string };
  readonly ownerActorId: string;
}

interface BillingState {
  readonly products: readonly { readonly productKey: string; readonly status: string }[];
}

interface CurrentCycleWindow {
  readonly cycles: readonly { readonly number: number }[];
}

interface RecurringTaskCreated {
  readonly series: { readonly id: string };
  readonly firstTask: { readonly id: string } | null;
  readonly occurrences: readonly { readonly task: { readonly id: string } }[];
}

interface AgentSessionDetail {
  readonly id: string;
}

/** Return whether a hostname can only address this machine. */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
}

/**
 * Reject any fixture topology that could write audit data outside the local machine.
 *
 * @param origins - The Web and API origins the fixture will use.
 */
export function assertLocalAuditOrigins(origins: MobileAuditOrigins): void {
  const entries = Object.entries(origins) as readonly [keyof MobileAuditOrigins, string][];
  for (const [name, value] of entries) {
    let hostname: string;
    try {
      hostname = new URL(value).hostname;
    } catch {
      throw new Error(`Mobile audit ${name} must be an absolute local host URL.`);
    }
    if (!isLocalHost(hostname)) {
      throw new Error(`Mobile audit ${name} must use a local host, received ${hostname}.`);
    }
  }
}

/** Resolve the explicit local API origin required for the billing-webhook seed. */
export function mobileAuditOrigins(page: Page): MobileAuditOrigins {
  const webOrigin = new URL(page.url()).origin;
  const configuredApiOrigin = process.env['API_URL'];
  if (!configuredApiOrigin) {
    throw new Error(
      'Mobile audit fixture requires API_URL so it can call the local billing webhook.',
    );
  }
  const origins = { apiOrigin: configuredApiOrigin, webOrigin };
  assertLocalAuditOrigins(origins);
  return origins;
}

/** Format a local calendar date without allowing a UTC conversion to shift the fixture window. */
function calendarDate(offsetDays: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** Give a fresh local shared workspace the entitlement that production checkout would provide. */
async function activateLocalDocketPro(
  page: Page,
  origins: MobileAuditOrigins,
  orgId: string,
): Promise<void> {
  const event = {
    id: `mobile-audit-${orgId}-${crypto.randomUUID()}`,
    type: 'subscription.updated',
    referenceId: orgId,
    createdAt: new Date().toISOString(),
    subscription: {
      id: `mobile-audit-subscription-${orgId}`,
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
  const response = await page.evaluate(
    async ({ event, url }) => {
      const webhook = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      return { status: webhook.status, ok: webhook.ok, body: await webhook.text() };
    },
    { event, url: `${origins.apiOrigin}/internal/billing/webhook` },
  );
  if (!response.ok) {
    throw new Error(`Local billing webhook returned ${String(response.status)}: ${response.body}`);
  }

  const billing = await apiJson<BillingState>(page, `/v1/orgs/${orgId}/billing`);
  const docketPro = billing.products.find((product) => product.productKey === 'docket_pro');
  if (docketPro?.status !== 'active') {
    throw new Error(
      'Local billing webhook did not activate Docket Pro for the mobile audit workspace.',
    );
  }
}

/** Create the complete local-only dataset used by the responsive audit matrix. */
export async function createMobileAuditFixture(page: Page): Promise<MobileAuditFixture> {
  const origins = mobileAuditOrigins(page);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const created = await apiJson<OrgCreateResult>(page, '/v1/orgs', {
    method: 'POST',
    body: {
      name: `Mobile audit ${suffix}`,
      purpose: 'Local visual and responsive verification only.',
      vocabulary: 'startup',
      isPersonal: false,
    },
  });
  const orgId = created.organization.id;
  await activateLocalDocketPro(page, origins, orgId);

  const person = await apiJson<{ actorId: string }>(page, `/v1/orgs/${orgId}/members`, {
    method: 'POST',
    body: { displayName: `Mobile audit collaborator ${suffix}` },
  });
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: {
      name: `Mobile audit initiative ${suffix}`,
      ownerId: created.ownerActorId,
      summary: 'A deliberately complete initiative for responsive audit routes.',
    },
  });
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: {
      name: `Mobile audit program ${suffix}`,
      ownerId: person.actorId,
      summary: 'A deliberately complete program for responsive audit routes.',
    },
  });
  const blockingProject = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: `Mobile audit blocking project with a long label ${suffix}`,
      teamId: created.defaultTeam.id,
      leadId: person.actorId,
      programId: program.id,
      summary: 'The dependency source for the responsive project graph.',
    },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: `Mobile audit dependent project with an intentionally long label ${suffix}`,
      teamId: created.defaultTeam.id,
      leadId: created.ownerActorId,
      programId: program.id,
      summary: 'The responsive audit project that carries a dependency and assigned work.',
      initiativeIds: [initiative.id],
    },
  });
  await apiJson(page, `/v1/orgs/${orgId}/projects/${project.id}/dependencies`, {
    method: 'POST',
    body: { blockingProjectId: blockingProject.id },
  });

  const currentWindow = await apiJson<CurrentCycleWindow>(
    page,
    `/v1/orgs/${orgId}/cycles/current?teamId=${created.defaultTeam.id}`,
  );
  const nextCycleNumber = Math.max(0, ...currentWindow.cycles.map((cycle) => cycle.number)) + 1;
  const cycle = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/cycles`, {
    method: 'POST',
    body: {
      teamId: created.defaultTeam.id,
      number: nextCycleNumber,
      name: `Mobile audit cycle ${nextCycleNumber}`,
      startsAt: calendarDate(-7),
      endsAt: calendarDate(7),
      status: 'active',
    },
  });
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: {
      title: `Mobile audit assigned task ${suffix}`,
      teamId: created.defaultTeam.id,
      assigneeId: person.actorId,
      projectId: project.id,
      cycleId: cycle.id,
    },
  });
  const recurring = await apiJson<RecurringTaskCreated>(page, `/v1/orgs/${orgId}/recurring-tasks`, {
    method: 'POST',
    body: {
      task: {
        title: `Mobile audit daily recurring task ${suffix}`,
        teamId: created.defaultTeam.id,
        assigneeId: person.actorId,
        projectId: project.id,
      },
      schedule: {
        kind: 'daily',
        interval: 1,
        startDate: calendarDate(0),
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
      },
      missedPolicy: 'skip',
      materialization: { horizonDays: 7, minimumOccurrences: 1 },
    },
  });
  const recurringTaskId = recurring.firstTask?.id ?? recurring.occurrences[0]?.task.id;
  if (!recurringTaskId) {
    throw new Error('The mobile audit recurring task did not materialize its first occurrence.');
  }
  const session = await apiJson<AgentSessionDetail>(page, `/v1/orgs/${orgId}/sessions/chat`);

  return {
    orgId,
    ownerActorId: created.ownerActorId,
    teamId: created.defaultTeam.id,
    personId: person.actorId,
    initiativeId: initiative.id,
    programId: program.id,
    projectId: project.id,
    blockingProjectId: blockingProject.id,
    cycleId: cycle.id,
    taskId: task.id,
    recurrenceSeriesId: recurring.series.id,
    recurringTaskId,
    agentSessionId: session.id,
  };
}

/** Read every fixture record back through the API before a browser audit relies on it. */
export async function verifyMobileAuditFixture(
  page: Page,
  fixture: MobileAuditFixture,
): Promise<void> {
  await Promise.all([
    apiJson(page, `/v1/orgs/${fixture.orgId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/members/${fixture.ownerActorId}/profile`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/teams/${fixture.teamId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/members/${fixture.personId}/profile`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/initiatives/${fixture.initiativeId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/programs/${fixture.programId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/projects/${fixture.projectId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/projects/${fixture.blockingProjectId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/cycles/${fixture.cycleId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/tasks/${fixture.taskId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/recurrence-series/${fixture.recurrenceSeriesId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/tasks/${fixture.recurringTaskId}`),
    apiJson(page, `/v1/orgs/${fixture.orgId}/sessions/${fixture.agentSessionId}`),
  ]);
}
