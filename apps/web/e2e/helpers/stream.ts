/** Real API fixture for Stream episode and visual journeys. */
import type { Page } from '@playwright/test';

import { apiJson } from './net';

/** Seed adjacent substantive and minor events about one task plus an intervening second subject. */
export async function seedStreamTimeline(page: Page, orgId: string): Promise<void> {
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('The Stream fixture requires the onboarding workspace team.');

  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Ship the beta', teamId },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { description: 'Draft the release notes.' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { description: 'Draft the release notes and verify migration safety.' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { priority: 'urgent', dueDate: '2026-08-19' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { state: 'in_progress' },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}`, {
    method: 'PATCH',
    body: { state: 'done' },
  });

  await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Prepare launch notes', teamId },
  });
}
