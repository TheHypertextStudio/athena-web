import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { WorkTemplateDefinition, type WorkTemplateOut } from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { apiJson } from './net';
import { signUpAndOnboard } from './app';
import { createMobileAuditFixture, type MobileAuditFixture } from './mobile-audit-fixture';
import { TIMEOUTS } from './constants';

const fixtures = new WeakMap<BrowserContext, MobileAuditFixture>();
/** Enter or revisit a definition step through its responsive navigation. */
export async function selectWorkDefinitionSection(
  page: Page,
  label: 'Purpose' | 'Starting work' | 'Included work' | 'Review',
): Promise<void> {
  await page.locator('[data-template-definition-header]').waitFor({ state: 'visible' });
  const creation = page.getByRole('navigation', { name: 'Create template', exact: true });
  if (await creation.isVisible()) {
    const destination = creation.getByRole('button', { name: label, exact: true });
    for (let step = 0; step < 3 && (await destination.isDisabled()); step++) {
      await page.getByRole('button', { name: /^Continue to / }).click();
    }
    await destination.click();
    return;
  }
  const chooser = page.getByRole('button', { name: 'Change template section', exact: true });
  if (await chooser.isVisible()) {
    await chooser.click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  } else await page.getByRole('tab', { name: label, exact: true }).click();
}
/** Reuse a ceremony-created local session and populate a real entitled audit workspace through the API. */
export async function blueprintWorkspace(page: Page): Promise<MobileAuditFixture> {
  const workspace = await populatedBlueprintWorkspace(page);
  await visitBlueprintDailyPlanner(page);
  return workspace;
}
/** Enter the actual planner before work-definition review so its daily announcement cannot steal focus. */
export async function visitBlueprintDailyPlanner(page: Page): Promise<void> {
  const preferences = await apiJson<{ timezone: string }>(page, '/v1/hub/preferences');
  const date = new Date().toLocaleDateString('en-CA', { timeZone: preferences.timezone });
  await page.goto(new URL(`/plan/day?date=${date}`, page.url()).href, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('heading', { name: /^Plan (today|tomorrow|day)$/ }).waitFor();
}
async function populatedBlueprintWorkspace(page: Page): Promise<MobileAuditFixture> {
  const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
  await page.goto('/', { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  const context = page.context();
  const existing = fixtures.get(context);
  if (existing) return existing;
  if (session) {
    const metadata = JSON.parse(readFileSync(`${session}.meta.json`, 'utf8')) as {
      mobileAuditFixture?: MobileAuditFixture;
    };
    if (metadata.mobileAuditFixture) {
      fixtures.set(context, metadata.mobileAuditFixture);
      return metadata.mobileAuditFixture;
    }
  } else await signUpAndOnboard(page, 'WorkBlueprints');
  const fixture = await createMobileAuditFixture(page);
  fixtures.set(context, fixture);
  return fixture;
}
/** A published root with one required and one optional child, distinguishable in a populated workspace. */
export interface BlueprintRuntimeTemplate {
  readonly publication: WorkTemplateOut;
  readonly rootTitle: string;
  readonly childTitle: string;
  readonly optionalTitle: string;
  readonly childKind: 'project' | 'task';
}
/** Seed through the public canonical authoring and publication APIs, retaining real permission checks. */
export async function seedBlueprintTemplate(
  page: Page,
  orgId: string,
  kind: TemplateTargetType,
): Promise<BlueprintRuntimeTemplate> {
  const suffix = `${kind} ${Date.now()}`;
  const childKind = kind === 'initiative' || kind === 'program' ? 'project' : 'task';
  const rootTitle = `Dinner ${suffix}`,
    childTitle = `Prepare ${suffix}`,
    optionalTitle = `Optional ${suffix}`;
  const step = (key: string, title: string, optional: boolean) => ({
    key,
    kind: childKind,
    parentStepKey: null,
    sort: optional ? 1 : 0,
    fields: {
      [childKind === 'task' ? 'title' : 'name']: title,
      description: 'Confirm the goal, then record the outcome.',
    },
    template: null,
    optional: { enabled: optional, selectedByDefault: true },
    teamRule: 'creation_team',
    actorRule: 'creator',
    ...(childKind === 'task' ? { cycleRule: 'none' } : {}),
    dates:
      childKind === 'task' && kind === 'project'
        ? {
            dueDate: {
              kind: 'anchor',
              anchor: { kind: 'parent' },
              offset: { days: -2, unit: 'calendar' },
            },
          }
        : {},
  });
  const definition = WorkTemplateDefinition.parse({
    name: `Dinner kit ${suffix}`,
    description: 'Prepare a community dinner with a reviewable optional step.',
    payload: {
      targetType: kind,
      [kind === 'task' ? 'title' : 'name']: rootTitle,
      description: 'Welcome the neighbors and record what the dinner needs.',
    },
    blueprint: {
      steps: [step('prepare', childTitle, false), step('optional', optionalTitle, true)],
      dependencies: [],
    },
  });
  const path = `/v1/orgs/${orgId}/templates/definitions`;
  const draft = await apiJson<WorkTemplateOut>(page, path, {
    method: 'POST',
    body: { targetType: kind, scope: 'personal', offeredTeamIds: [], definition },
  });
  const publication = await apiJson<WorkTemplateOut>(page, `${path}/${draft.id}/publish`, {
    method: 'POST',
    body: { expectedRevision: draft.revision },
  });
  return { publication, rootTitle, childTitle, optionalTitle, childKind };
}

/** Persist real composer input so standard responsive captures can reopen the same child review. */
export async function seedBlueprintReviewDraft(
  page: Page,
  orgId: string,
  teamId: string,
  seeded: BlueprintRuntimeTemplate,
): Promise<ComposerDraftOut> {
  return apiJson<ComposerDraftOut>(page, '/v1/me/drafts', {
    method: 'POST',
    body: {
      organizationId: orgId,
      kind: 'project',
      payload: {
        kind: 'project',
        name: 'Community dinner review',
        description: 'Welcome the neighbors and review the preparation work before creating it.',
        teamOverride: teamId,
        workTypeId: seeded.publication.id,
        workTypeVersionId: seeded.publication.latestVersion?.id,
        blueprint: { creationTeamId: teamId, optionalChoices: [] },
      },
    },
  });
}
