/**
 * Initiative actions for command palette.
 *
 * These actions allow users to create, view, and manage initiatives directly
 * from the command palette. Initiative actions are context-aware - edit and
 * delete actions only appear when viewing an initiative.
 *
 * ## Available Actions
 *
 * | Action | Shortcut | Context | Description |
 * |--------|----------|---------|-------------|
 * | Create Initiative | `c i` | Always | Create a new initiative |
 * | Go to Initiatives | `g i` | Always | Navigate to initiatives list |
 * | Edit Initiative | - | Initiative selected | Edit the current initiative |
 * | Delete Initiative | - | Initiative selected | Delete the current initiative |
 *
 * @packageDocumentation
 */

import { Plus, Target, Edit, Trash2, ArrowRight } from 'lucide-react';
import { z } from 'zod';

import type { ExecutableAction, Action } from '../types';
import { initiativesApi } from '@/lib/api-client';

/**
 * Go to initiatives navigation action.
 */
export const goToInitiativesAction: ExecutableAction = {
  type: 'action',
  id: 'go-to-initiatives',
  label: 'Go to Initiatives',
  icon: Target,
  category: 'navigation',
  keywords: ['navigate', 'view', 'list', 'goals', 'strategic'],
  priority: 75,
  shortcut: {
    id: 'go-to-initiatives',
    keys: 'g i',
    scope: 'global',
  },
  execute: () =>
    Promise.resolve({
      success: true,
      navigateTo: '/initiatives',
    }),
};

/**
 * Create initiative action.
 *
 * Opens an inline form to create a new initiative.
 */
export const createInitiativeAction: ExecutableAction = {
  type: 'action',
  id: 'create-initiative',
  label: 'Create Initiative',
  icon: Plus,
  category: 'create',
  keywords: ['new', 'add', 'goal', 'strategic', 'objective'],
  priority: 85,
  shortcut: {
    id: 'create-initiative',
    keys: 'c i',
    scope: 'global',
  },
  form: () => ({
    fields: [
      {
        name: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'What do you want to achieve?',
        schema: z.string().min(1, 'Name is required').max(200),
        required: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Describe your goal and how you plan to achieve it...',
        schema: z.string().max(2000).optional(),
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        schema: z.enum(['draft', 'active']).optional(),
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'active', label: 'Active' },
        ],
        defaultValue: 'draft',
      },
    ],
    submitLabel: 'Create Initiative',
    autoFocus: true,
  }),
  execute: async ({ formData }) => {
    try {
      const name = typeof formData?.name === 'string' ? formData.name : '';
      const description =
        typeof formData?.description === 'string' ? formData.description : undefined;
      // Note: status is now handled via custom statuses (statusId)
      // For quick creation, we rely on the backend default status

      const response = await initiativesApi.create({
        name,
        description,
      });

      return {
        success: true,
        message: `Created initiative: ${name}`,
        invalidate: ['initiatives'],
        navigateTo: `/initiatives/${response.data.id}`,
      };
    } catch {
      return {
        success: false,
        message: 'Failed to create initiative',
      };
    }
  },
};

/**
 * Edit initiative action.
 *
 * Only available when viewing an initiative. Pre-fills the form with the
 * current initiative's data from context.
 */
export const editInitiativeAction: ExecutableAction = {
  type: 'action',
  id: 'edit-initiative',
  label: 'Edit Initiative',
  icon: Edit,
  category: 'entity',
  keywords: ['modify', 'update', 'change', 'goal'],
  priority: 90,
  isAvailable: (ctx) => {
    if (ctx.entity?.type !== 'initiative') {
      return false;
    }
    return true;
  },
  form: (ctx) => {
    const initiative = ctx.entity?.data as
      | {
          name?: string;
          description?: string;
        }
      | undefined;

    return {
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          schema: z.string().min(1).max(200),
          defaultValue: initiative?.name ?? '',
          required: true,
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          schema: z.string().max(2000).optional(),
          defaultValue: initiative?.description ?? '',
        },
        // Status changes should be done via the initiative detail page
        // which properly handles custom status selection
      ],
      submitLabel: 'Save Changes',
    };
  },
  execute: async ({ formData, context }) => {
    const initiativeId = context.entity?.id;

    if (!initiativeId) {
      return {
        success: false,
        message: 'No initiative selected',
      };
    }

    try {
      const name = typeof formData?.name === 'string' ? formData.name : undefined;
      const description =
        typeof formData?.description === 'string' ? formData.description : undefined;
      // Note: status changes should be done via the status management UI
      // which handles custom status IDs properly

      await initiativesApi.update(initiativeId, {
        name,
        description: description ?? null,
      });

      return {
        success: true,
        message: 'Initiative updated',
        invalidate: ['initiatives', initiativeId],
      };
    } catch {
      return {
        success: false,
        message: 'Failed to update initiative',
      };
    }
  },
};

/**
 * Delete initiative action.
 *
 * Only available when viewing an initiative. Shows a confirmation before
 * deleting.
 */
export const deleteInitiativeAction: ExecutableAction = {
  type: 'action',
  id: 'delete-initiative',
  label: 'Delete Initiative',
  icon: Trash2,
  category: 'entity',
  keywords: ['remove', 'trash', 'goal'],
  priority: 10,
  isAvailable: (ctx) => {
    if (ctx.entity?.type !== 'initiative') {
      return false;
    }
    return true;
  },
  form: (ctx) => {
    const initiative = ctx.entity?.data as { name?: string } | undefined;

    return {
      fields: [
        {
          name: 'confirm',
          label: `Delete "${initiative?.name ?? 'this initiative'}"?`,
          type: 'checkbox',
          description:
            'This will also remove initiative associations from projects. This action cannot be undone.',
          schema: z.boolean().refine((v) => v, {
            message: 'You must confirm deletion',
          }),
          required: true,
        },
      ],
      submitLabel: 'Delete',
    };
  },
  execute: async ({ formData, context }) => {
    const initiativeId = context.entity?.id;

    if (!initiativeId) {
      return {
        success: false,
        message: 'No initiative selected',
      };
    }

    if (!formData?.confirm) {
      return {
        success: false,
        message: 'Deletion not confirmed',
      };
    }

    try {
      await initiativesApi.delete(initiativeId);

      return {
        success: true,
        message: 'Initiative deleted',
        invalidate: ['initiatives'],
        navigateTo: '/initiatives',
      };
    } catch {
      return {
        success: false,
        message: 'Failed to delete initiative',
      };
    }
  },
};

/**
 * View initiative action.
 *
 * Quick action to navigate to the current initiative's detail page.
 * Only available when an initiative is selected but not on the detail page.
 */
export const viewInitiativeAction: ExecutableAction = {
  type: 'action',
  id: 'view-initiative',
  label: 'View Initiative Details',
  icon: ArrowRight,
  category: 'entity',
  keywords: ['open', 'details', 'show'],
  priority: 95,
  isAvailable: (ctx) => {
    // Available if initiative is selected and we're not already on its detail page
    if (ctx.entity?.type !== 'initiative') {
      return false;
    }
    const isOnDetailPage = ctx.route.startsWith(`/initiatives/${ctx.entity.id}`);
    return !isOnDetailPage;
  },
  execute: ({ context }) => {
    const initiativeId = context.entity?.id;

    if (!initiativeId) {
      return Promise.resolve({
        success: false,
        message: 'No initiative selected',
      });
    }

    return Promise.resolve({
      success: true,
      navigateTo: `/initiatives/${initiativeId}`,
    });
  },
};

/**
 * All initiative actions (flat list).
 */
export const initiativeActions: Action[] = [
  goToInitiativesAction,
  createInitiativeAction,
  editInitiativeAction,
  viewInitiativeAction,
  deleteInitiativeAction,
];
