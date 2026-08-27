import type { Locator, Page } from '@playwright/test';

/** Find the primary long-form description editor through its accessible contract. */
export function descriptionEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Description', exact: true });
}

/** Find the task Activity surface by its user-visible landmark name. */
export function taskActivity(page: Page): Locator {
  return page.getByRole('region', { name: 'Activity', exact: true });
}
