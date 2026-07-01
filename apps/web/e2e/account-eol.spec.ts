/**
 * Account end-of-life e2e: data export (download a real ZIP) + recoverable account deletion.
 *
 * Exercises the personal-workspace "Export data" and "Danger zone" surfaces end to end against the
 * running dev stack. The export becomes ready via the API's in-process dev scheduler (APP_MODE=
 * local); the deletion step-up re-auth is auto-approved by the virtual authenticator.
 */
import { signUpAndOnboard } from './helpers/app';
import { TIMEOUTS, settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';

test.describe('account end-of-life', () => {
  test('exports account data as a downloadable ZIP', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'Export');

    await page.goto(settingsHref(orgId, 'export'));
    await page.getByRole('button', { name: 'Request export' }).click();

    // The in-process dev sweep readies the export within a few seconds.
    await expect(page.getByText('Your export is ready')).toBeVisible({ timeout: TIMEOUTS.sweep });

    // Fetch the export's binary sub-resource with the session cookie (the page's request context
    // shares it) and assert it serves a real ZIP attachment — deterministic, no cross-origin
    // browser-download flakiness.
    const href = await page.getByRole('link', { name: 'Download your data' }).getAttribute('href');
    expect(href, 'download link should have an href').toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status(), 'download should succeed').toBe(200);
    expect(res.headers()['content-type']).toContain('zip');
    expect(res.headers()['content-disposition']).toMatch(
      /attachment; filename="docket-export-.+\.zip"/,
    );
    const body = await res.body();
    expect(body.length, 'archive should be non-empty').toBeGreaterThan(100);
    expect(body.subarray(0, 2).toString('latin1'), 'archive should be a ZIP (PK magic)').toBe('PK');
  });

  test('schedules then cancels recoverable account deletion', async ({ page }) => {
    const { user, orgId } = await signUpAndOnboard(page, 'Deleter');

    await page.goto(settingsHref(orgId, 'danger'));
    await page.getByRole('button', { name: /^Delete account/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill(user.email); // type-to-confirm gate
    await dialog.getByRole('button', { name: 'Delete my account' }).click(); // → passkey step-up (auto)

    await expect(page.getByText('Your account is scheduled for deletion')).toBeVisible({
      timeout: TIMEOUTS.ceremony,
    });

    await page.getByRole('button', { name: 'Cancel deletion' }).click();
    await expect(page.getByRole('button', { name: /^Delete account/ })).toBeVisible({
      timeout: TIMEOUTS.ceremony,
    });
  });
});
