/**
 * Initiative status schemas for validation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const InitiativeStatusCategory = z.enum(['planning', 'active', 'completed', 'archived']);
export type InitiativeStatusCategory = z.infer<typeof InitiativeStatusCategory>;

export const ListInitiativeStatusesInput = z.object({
  workspaceId: z.string().optional(),
  category: InitiativeStatusCategory.optional(),
});
export type ListInitiativeStatusesInput = z.infer<typeof ListInitiativeStatusesInput>;

export const CreateInitiativeStatusInput = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  category: InitiativeStatusCategory,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icon: z.string().max(50).optional(),
  workspaceId: z.string().optional(),
});
export type CreateInitiativeStatusInput = z.infer<typeof CreateInitiativeStatusInput>;

export const UpdateInitiativeStatusInput = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(500).nullish(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  icon: z.string().max(50).nullish(),
});
export type UpdateInitiativeStatusInput = z.infer<typeof UpdateInitiativeStatusInput>;

export const ReorderInitiativeStatusesInput = z.object({
  category: InitiativeStatusCategory,
  statusIds: z.array(z.string()).min(1),
  workspaceId: z.string().optional(),
});
export type ReorderInitiativeStatusesInput = z.infer<typeof ReorderInitiativeStatusesInput>;

export const InitiativeStatusIdParam = z.object({
  id: z.string(),
});
export type InitiativeStatusIdParam = z.infer<typeof InitiativeStatusIdParam>;

/**
 * Default statuses created for each new workspace.
 */
export const DEFAULT_INITIATIVE_STATUSES: Omit<CreateInitiativeStatusInput, 'workspaceId'>[] = [
  // Planning category
  {
    name: 'Draft',
    category: 'planning',
    color: '#6B7280',
    description: 'Initiative is being planned or drafted',
    icon: 'file-edit',
  },
  {
    name: 'On Hold',
    category: 'planning',
    color: '#F59E0B',
    description: 'Initiative is paused temporarily',
    icon: 'pause',
  },

  // Active category
  {
    name: 'Active',
    category: 'active',
    color: '#3B82F6',
    description: 'Initiative is actively being worked on',
    icon: 'rocket',
  },

  // Completed category
  {
    name: 'Completed',
    category: 'completed',
    color: '#10B981',
    description: 'Initiative has been successfully completed',
    icon: 'check-circle',
  },

  // Archived category
  {
    name: 'Archived',
    category: 'archived',
    color: '#94A3B8',
    description: 'Initiative is archived and hidden from active views',
    icon: 'archive',
  },
];

/**
 * Default statuses that should be marked as default for their category.
 */
export const DEFAULT_STATUS_NAMES_BY_CATEGORY: Record<InitiativeStatusCategory, string> = {
  planning: 'Draft',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};
