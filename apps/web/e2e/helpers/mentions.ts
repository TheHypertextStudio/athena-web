/**
 * Seeding and waiting helpers for the `@`-mention specs.
 *
 * @remarks
 * The picker reads `search_document`, which a write only reaches after the outbox drains on the dev
 * scheduler's tick. A spec that typed `@` right after seeding would race that tick and fail as
 * though the picker were broken, so {@link waitForMentionable} polls the same endpoint the picker
 * calls until the entity is actually findable.
 */
import type { Locator, Page } from '@playwright/test';

import { TIMEOUTS } from './constants';
import { expect } from './fixtures';
import { apiFetch } from './net';

/** The entities a mention spec needs to point at. */
export interface MentionFixtures {
  /** The project whose description the specs type into. */
  readonly projectId: string;
  /** A task with a distinctive title, so a query matches it and nothing else. */
  readonly taskId: string;
  /** That task's title, which is what the picker row and the inserted chip should read. */
  readonly taskTitle: string;
}

/** POST `path` and return the created row's id, failing the test on a non-2xx. */
async function create(page: Page, path: string, body: unknown): Promise<string> {
  const result = await apiFetch(page, path, { method: 'POST', body });
  expect(result.status, `${path} should create`).toBe(200);
  return (result.body as { id: string }).id;
}

/**
 * Seed a project and a task the specs can mention.
 *
 * @param page - A page with a signed-in session.
 * @param orgId - The workspace to seed into.
 * @returns The seeded ids and the task's title.
 */
export async function seedMentionFixtures(page: Page, orgId: string): Promise<MentionFixtures> {
  const teams = await apiFetch(page, `/v1/orgs/${orgId}/teams`);
  const teamId = (teams.body as { items: { id: string }[] }).items[0]?.id ?? '';
  expect(teamId, 'onboarding should have left a team to file tasks under').not.toBe('');

  // The shared prefix deliberately yields multiple result groups for the visual regression spec.
  const taskTitle = 'Zephyr rollout checklist';
  const projectId = await create(page, `/v1/orgs/${orgId}/projects`, {
    name: 'Zephyr platform rebuild',
    description: 'The umbrella for the migration.',
  });
  const taskId = await create(page, `/v1/orgs/${orgId}/tasks`, { title: taskTitle, teamId });
  return { projectId, taskId, taskTitle };
}

/**
 * Wait until `query` finds `title` through the picker's own endpoint.
 *
 * @param page - A page with a signed-in session.
 * @param orgId - The workspace being searched.
 * @param query - What the spec is about to type after the `@`.
 * @param title - The row title that must appear.
 */
export async function waitForMentionable(
  page: Page,
  orgId: string,
  query: string,
  title: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/mentions/search?q=${encodeURIComponent(query)}`,
        );
        const items = (result.body as { items?: { title: string }[] }).items ?? [];
        return items.some((item) => item.title === title);
      },
      { timeout: TIMEOUTS.sweep, message: `"${title}" should become mentionable` },
    )
    .toBe(true);
}

/**
 * Type an `@` query into a field and wait for the menu to list something.
 *
 * @remarks
 * Types through the locator rather than through `page.keyboard`, so the keys are delivered to the
 * field itself. A page-level `keyboard.type` goes wherever focus happens to be, and a composer
 * that has not finished hydrating swallows the whole string with no error — which reads as a
 * broken picker rather than a mistargeted test.
 *
 * @param field - The field the mention belongs in.
 * @param query - The characters to type after the `@`.
 */
export async function openMentionMenu(field: Locator, query: string): Promise<void> {
  await field.pressSequentially(`@${query}`);
  await expect(field.page().getByRole('option').first()).toBeVisible({ timeout: TIMEOUTS.ui });
}
