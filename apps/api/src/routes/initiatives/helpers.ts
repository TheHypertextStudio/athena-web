/**
 * Initiative route helpers.
 *
 * @packageDocumentation
 */

import { eq, and } from 'drizzle-orm';
import type { InitiativeStatus } from '@athena/types/openapi/initiatives';
import { db } from '../../db/index.js';
import { customInitiativeStatuses } from '../../db/schema/index.js';

export type InitiativeStatusCategory = 'planning' | 'active' | 'completed' | 'archived';

const STATUS_CATEGORY_BY_STATUS: Record<InitiativeStatus, InitiativeStatusCategory> = {
  draft: 'planning',
  active: 'active',
  completed: 'completed',
  archived: 'archived',
};

const STATUS_BY_CATEGORY: Record<InitiativeStatusCategory, InitiativeStatus> = {
  planning: 'draft',
  active: 'active',
  completed: 'completed',
  archived: 'archived',
};

export function toStatusCategory(status: InitiativeStatus): InitiativeStatusCategory {
  return STATUS_CATEGORY_BY_STATUS[status];
}

export function toInitiativeStatus(category: InitiativeStatusCategory): InitiativeStatus {
  return STATUS_BY_CATEGORY[category];
}

export function buildValidationError(field: string, message: string) {
  return {
    error: 'Validation error' as const,
    details: [{ field, message }],
  };
}

/**
 * Look up custom status and return its details.
 */
export async function getCustomStatus(statusId: string) {
  return db.query.customInitiativeStatuses.findFirst({
    where: eq(customInitiativeStatuses.id, statusId),
  });
}

/**
 * Get the default status for a category (first status marked as default, or first by position).
 */
export async function getDefaultStatus(category: InitiativeStatusCategory = 'planning') {
  // First try to find a default status for this category
  let status = await db.query.customInitiativeStatuses.findFirst({
    where: and(
      eq(customInitiativeStatuses.category, category),
      eq(customInitiativeStatuses.isDefault, true),
    ),
  });

  // Fall back to first status in the category by position
  status ??= await db.query.customInitiativeStatuses.findFirst({
    where: eq(customInitiativeStatuses.category, category),
    orderBy: (s, { asc }) => [asc(s.position)],
  });

  return status;
}
