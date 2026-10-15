import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { blueprintWorkspace } from './helpers/work-template-blueprints';
import { TIMEOUTS } from './helpers/constants';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

test('short-phone capture keeps name inset and save reachable while reviewing a long outline', async ({
  page,
}) => {
  const workspace = await blueprintWorkspace(page);
  const source = await apiJson<{ id: string }>(page, `/v1/orgs/${workspace.orgId}/projects`, {
    method: 'POST',
    body: {
      name: `Capture layout ${Date.now()}`,
      teamId: workspace.teamId,
      description: Array.from(
        { length: 30 },
        (_, index) => `Outline section ${index + 1}: keep the preparation requirements readable.`,
      ).join('\n\n'),
    },
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto(`/orgs/${workspace.orgId}/projects/${source.id}`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Save as template', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template', exact: true });
  const name = dialog.getByRole('textbox', { name: 'Template name', exact: true });
  await expect(name).toHaveValue(/Capture layout/);
  const frame = await dialog.boundingBox(),
    input = await name.boundingBox();
  if (!frame || !input) throw new Error('Capture geometry missing');
  expect(input.x - frame.x).toBeGreaterThanOrEqual(20);
  await expect(
    dialog.getByRole('button', { name: 'Save private draft', exact: true }),
  ).toBeInViewport();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('authors a private Project child outline and relative due date, reopens it, and publishes', async ({
  page,
}) => {
  const { orgId } = await blueprintWorkspace(page);
  await page.goto(`/orgs/${orgId}/settings/templates/new`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('combobox', { name: 'Kind of work', exact: true }).selectOption('project');
  const title = `Authored blueprint ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Icon and draft visibility', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Draft visible to', exact: true })).toHaveValue(
    'personal',
  );
  await page.getByRole('button', { name: 'Define the work', exact: true }).click();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const child = page.getByRole('group', { name: /^Child work:/ }).first();
  await child.getByRole('textbox', { name: 'Child title', exact: true }).fill('Confirm the venue');
  await child
    .getByRole('textbox', { name: 'Child document', exact: true })
    .fill('Record the venue agreement and accessibility requirements.');
  await child.getByRole('button', { name: 'Dates', exact: true }).click();
  await child.getByRole('combobox', { name: 'Due date rule', exact: true }).selectOption('parent');
  await child.getByRole('spinbutton', { name: 'Due offset days', exact: true }).fill('-3');
  await child
    .getByRole('combobox', { name: 'Due offset unit', exact: true })
    .selectOption('working');
  const optional = child.getByRole('checkbox', { name: 'Optional child', exact: true });
  await optional.focus();
  await page.keyboard.press('Space');
  await expect(optional).toBeChecked();
  await page.keyboard.press('Space');
  await expect(optional).not.toBeChecked();
  const saved = waitForApiResponse(page, /\/templates\/definitions$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const draft = (await response.json()) as WorkTemplateOut;
  expect(draft.scope).toBe('personal');
  expect(draft.latestVersion).toBeNull();
  await expect(page).toHaveURL(new RegExp(`/templates/${draft.id}$`));
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByRole('status').filter({ hasText: /^Saved draft$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review definition', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit Confirm the venue', exact: true }).click();
  await expect(child.getByRole('textbox', { name: 'Child title', exact: true })).toHaveValue(
    'Confirm the venue',
  );
  await expect(child.getByRole('textbox', { name: 'Child document', exact: true })).toContainText(
    'venue agreement',
  );
  await child.getByRole('button', { name: 'Dates', exact: true }).click();
  await expect(child.getByRole('spinbutton', { name: 'Due offset days', exact: true })).toHaveValue(
    '-3',
  );
  await expect(child.getByRole('combobox', { name: 'Due offset unit', exact: true })).toHaveValue(
    'working',
  );
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Publish to workspace', exact: true }),
  ).toBeEnabled();
  const publication = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
  expect((await publication).ok()).toBe(true);
  const published = await apiJson<WorkTemplateOut>(
    page,
    `/v1/orgs/${orgId}/templates/definitions/${draft.id}`,
  );
  const step = published.latestVersion?.definition.blueprint.steps[0];
  expect(step).toMatchObject({
    kind: 'task',
    fields: {
      title: 'Confirm the venue',
      description: 'Record the venue agreement and accessibility requirements.',
    },
    dates: {
      dueDate: {
        kind: 'anchor',
        anchor: { kind: 'parent' },
        offset: { days: -3, unit: 'working' },
      },
    },
    optional: { enabled: false, selectedByDefault: true },
  });
});

test('roundtrips working weekdays through keyboard settings interaction and reload', async ({
  page,
}) => {
  const { orgId } = await blueprintWorkspace(page);
  const path = `/v1/orgs/${orgId}/settings/work-structure`;
  const before = await apiJson<{ workingWeekdays: number[] }>(page, path);
  await page.goto(`/orgs/${orgId}/settings/general`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  const calendar = page.getByRole('group', { name: 'Working weekdays', exact: true });
  const saturday = calendar.getByRole('checkbox', { name: 'Saturday', exact: true });
  await expect(saturday).toBeEnabled();
  const initial = before.workingWeekdays.includes(6);
  await saturday.focus();
  const saved = waitForApiResponse(page, /\/settings\/work-structure$/, { method: 'PATCH' });
  await page.keyboard.press('Space');
  expect((await saved).ok()).toBe(true);
  await page.reload({ waitUntil: 'commit' });
  await expect(saturday).toBeChecked({ checked: !initial });
  const restored = waitForApiResponse(page, /\/settings\/work-structure$/, { method: 'PATCH' });
  await saturday.focus();
  await page.keyboard.press('Space');
  expect((await restored).ok()).toBe(true);
  expect((await apiJson<{ workingWeekdays: number[] }>(page, path)).workingWeekdays).toEqual(
    before.workingWeekdays,
  );
});
