import { writeFileSync } from 'node:fs';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { blueprintWorkspace } from './helpers/work-template-blueprints';
import { TIMEOUTS } from './helpers/constants';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

async function eventDefinition(
  page: Parameters<typeof blueprintWorkspace>[0],
  orgId: string,
): Promise<WorkTemplateOut> {
  const path = `/v1/orgs/${orgId}/templates/definitions`;
  const vendor = await apiJson<WorkTemplateOut>(page, path, {
    method: 'POST',
    body: {
      targetType: 'task',
      scope: 'personal',
      definition: {
        name: 'Vendor booking',
        payload: {
          targetType: 'task',
          title: 'Confirm the caterer',
          description:
            'Agree the menu, dietary requirements, delivery time, and cancellation terms.',
        },
      },
    },
  });
  await apiJson(page, `${path}/${vendor.id}/publish`, {
    method: 'POST',
    body: { expectedRevision: vendor.revision },
  });
  const task = (key: string, title: string, days: number) => ({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: days + 30,
    fields: {
      title,
      description: 'Record the agreement and anything the event lead needs to know.',
    },
    template: null,
    optional: { enabled: false, selectedByDefault: true },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
    cycleRule: 'none',
    dates: {
      dueDate: { kind: 'anchor', anchor: { kind: 'parent' }, offset: { days, unit: 'calendar' } },
    },
  });
  return apiJson<WorkTemplateOut>(page, path, {
    method: 'POST',
    body: {
      targetType: 'project',
      scope: 'personal',
      definition: WorkTemplateDefinition.parse({
        name: 'Event',
        description: 'Community gatherings with preparation, a shared event day, and follow-up.',
        payload: {
          targetType: 'project',
          name: 'Community dinner',
          summary: 'A welcoming, accessible dinner for our neighbors.',
          description:
            '## Purpose\nBring neighbors together over a shared meal.\n\n## Preparation\nConfirm the venue, access needs, food, and volunteer roles.\n\n## On the day\nWelcome guests and make sure everyone can participate.\n\n## Follow-up\nThank volunteers and record what to improve next time.',
        },
        blueprint: {
          steps: [
            task('venue', 'Book venue', -21),
            task('access', 'Confirm accessibility', -14),
            {
              ...task('vendor', 'Vendor booking', -7),
              template: { workTypeId: vendor.id, selection: { kind: 'latest' } },
              optional: { enabled: true, selectedByDefault: true },
            },
            {
              key: 'event_day',
              kind: 'milestone',
              parentStepKey: null,
              sort: 40,
              fields: { name: 'Dinner day' },
              template: null,
              optional: { enabled: false, selectedByDefault: true },
              teamRule: 'parent_team',
              actorRule: 'unassigned',
              dates: {
                targetDate: {
                  kind: 'anchor',
                  anchor: { kind: 'parent' },
                  offset: { days: 0, unit: 'calendar' },
                },
              },
            },
          ],
          dependencies: [],
        },
      }),
    },
  });
}

test('Event work definition is revisitable, preserves selected work, and reviews responsibilities before publication', async ({
  page,
}) => {
  const { orgId } = await blueprintWorkspace(page);
  const draft = await eventDefinition(page, orgId);
  const route = `/orgs/${orgId}/work-templates/${draft.id}`;
  await page.goto(route, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const outline = page.getByRole('list', { name: 'Child work outline' });
  await expect(outline.getByRole('listitem')).toHaveCount(4);
  await expect(outline).toContainText('Due 21 days before Event date');
  await page.getByRole('button', { name: 'Edit Dinner day', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved draft$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review definition', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to outline', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Book venue', exact: true }).click();
  const child = page.getByRole('group', { name: 'Child work: Book venue', exact: true });
  await child.getByRole('button', { name: 'Add a summary', exact: true }).click();
  await child
    .getByRole('textbox', { name: 'Child summary', exact: true })
    .fill('Check capacity, access, kitchen facilities, and the booking terms.');
  await page.getByRole('tab', { name: 'Purpose', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Template name', exact: true })).toHaveValue(
    'Event',
  );
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await expect(child.getByRole('textbox', { name: 'Child summary', exact: true })).toHaveValue(
    'Check capacity, access, kitchen facilities, and the booking terms.',
  );
  const document = child.getByRole('textbox', { name: 'Child document', exact: true });
  await document.fill(
    Array.from(
      { length: 18 },
      (_, index) => `Preparation requirement ${index + 1}: keep the venue plan readable.`,
    ).join('\n\n'),
  );
  await document.focus();
  const scroll = await page.getByRole('main').evaluate((element) => element.scrollTop);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const review = page.getByRole('region', { name: 'Work definition review' });
  await expect(review).toContainText('Project lead · Project team, otherwise selected team');
  await expect(review).toContainText('Due 21 days before Event date');
  await expect(review.getByRole('heading', { name: 'Included work', exact: true })).toBeFocused();
  await expect(
    review.getByRole('heading', { name: 'Included work', exact: true }),
  ).toBeInViewport();
  await page.getByRole('tab', { name: 'Work', exact: true }).click();
  await expect(document).toBeFocused();
  await expect(document).toContainText('Preparation requirement 18');
  await expect
    .poll(() => page.getByRole('main').evaluate((element) => element.scrollTop))
    .toBe(scroll);
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const saved = waitForApiResponse(page, /\/draft$/, { method: 'PATCH' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const output = process.env['E2E_WORK_DEFINITION_FIXTURE_OUT'];
  if (output) writeFileSync(output, JSON.stringify({ orgId, id: draft.id, route }, null, 2));
});

test('saving a new definition from Review preserves Review and leaves publishing explicit', async ({
  page,
}) => {
  const { orgId } = await blueprintWorkspace(page);
  await page.goto(`/orgs/${orgId}/work-templates/new`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page
    .getByRole('textbox', { name: 'Template name', exact: true })
    .fill(`Volunteer onboarding ${Date.now()}`);
  await page
    .getByRole('textbox', { name: 'When to use it', exact: true })
    .fill('Welcome a new volunteer and help them get ready for their first event.');
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const saved = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const draft = (await (await saved).json()) as WorkTemplateOut;
  expect(draft.scope).toBe('personal');
  expect(draft.latestVersion).toBeNull();
  await expect(page).toHaveURL(new RegExp(`/work-templates/${draft.id}\\?section=review$`));
  await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Publish to workspace', exact: true }),
  ).toBeEnabled();
  await page.goto(`/orgs/${orgId}/work-templates/${draft.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('tab', { name: 'Work', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test.describe('phone work outline', () => {
  test.use({ hasTouch: true });
  test('child rows contain all title, timing and nested-template content at phone widths', async ({
    page,
  }) => {
    const { orgId } = await blueprintWorkspace(page);
    const draft = await eventDefinition(page, orgId);
    await page.goto(`/orgs/${orgId}/work-templates/${draft.id}`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 600 });
      const outline = page.getByRole('list', { name: 'Child work outline' });
      const rows = outline.getByRole('button');
      await expect(rows).toHaveCount(4);
      expect(
        await rows.evaluateAll((buttons) =>
          buttons.every((button) => {
            const outer = button.getBoundingClientRect();
            const content = button.firstElementChild?.getBoundingClientRect();
            return (
              content !== undefined &&
              content.top >= outer.top &&
              content.bottom <= outer.bottom &&
              outer.height >= 40
            );
          }),
        ),
      ).toBe(true);
    }
  });
});
