/** Open full selection details only when the narrow-screen peek is active. */
export async function openWorkDetails(app) {
  const button = app.getByRole('button', { name: 'Show details', exact: true });
  if (await button.isVisible()) await button.click();
}

/** Open the graph options before invoking a secondary workspace action. */
export async function graphAction(app, name) {
  const button = app.getByRole('button', { name, exact: true });
  if (!(await button.isVisible())) await app.locator('summary[aria-label="Graph options"]').click();
  await button.click();
}
