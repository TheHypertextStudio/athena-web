/**
 * Task actions for command palette.
 *
 * These actions allow users to create, edit, and manage tasks directly
 * from the command palette. Task actions are context-aware - edit and
 * delete actions only appear when viewing a task.
 *
 * ## Available Actions
 *
 * | Action | Shortcut | Context | Description |
 * |--------|----------|---------|-------------|
 * | Create Task | `c t` | Always | Create a new task |
 * | Edit Task | `e` | Task selected | Edit the current task |
 * | Delete Task | `d` | Task selected | Delete the current task |
 * | Complete Task | `x` | Task selected | Mark task as complete |
 *
 * ## Inline Forms
 *
 * The "Create Task" action uses an inline form to collect:
 * - Title (required)
 * - Description (optional)
 * - Project (optional)
 * - Due date (optional)
 * - Priority (optional)
 *
 * @packageDocumentation
 */

import { Plus, Edit, Trash2, CheckCircle2, CheckSquare } from 'lucide-react';
import { z } from 'zod';

import type { ExecutableAction, ActionGroup, Action } from '../types';

/**
 * Create task action.
 *
 * Opens an inline form to create a new task. Pre-fills the project
 * field if the user is viewing a project page.
 */
export const createTaskAction: ExecutableAction = {
  type: 'action',
  id: 'create-task',
  label: 'Create Task',
  icon: Plus,
  category: 'create',
  keywords: ['new', 'add', 'todo'],
  priority: 100,
  shortcut: {
    id: 'create-task',
    keys: 'c t',
    scope: 'global',
  },
  form: (_ctx) => ({
    fields: [
      {
        name: 'title',
        label: 'Title',
        type: 'text',
        placeholder: 'What needs to be done?',
        schema: z.string().min(1, 'Title is required').max(200),
        required: true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        placeholder: 'Add more details...',
        schema: z.string().max(5000).optional(),
      },
      {
        name: 'dueDate',
        label: 'Due Date',
        type: 'date',
        schema: z.string().optional(),
      },
      {
        name: 'priority',
        label: 'Priority',
        type: 'select',
        schema: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ],
      },
    ],
    submitLabel: 'Create Task',
    autoFocus: true,
  }),
  execute: async ({ formData, context: _context }) => {
    // TODO: Integrate with actual API
    console.log('[CreateTask] Creating task:', formData);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    const title = typeof formData?.title === 'string' ? formData.title : 'task';

    return {
      success: true,
      message: `Created task: ${title}`,
      invalidate: ['tasks'],
      // Could navigate to new task: navigateTo: `/tasks/${newTaskId}`
    };
  },
};

/**
 * Edit task action.
 *
 * Only available when viewing a task. Pre-fills the form with the
 * current task's data from context.
 */
export const editTaskAction: ExecutableAction = {
  type: 'action',
  id: 'edit-task',
  label: 'Edit Task',
  icon: Edit,
  category: 'entity',
  keywords: ['modify', 'update', 'change'],
  priority: 90,
  shortcut: {
    id: 'edit-task',
    keys: 'e',
    scope: 'global',
    allowInInput: false,
  },
  isAvailable: (ctx) => {
    if (ctx.entity?.type !== 'task') {
      return false;
    }
    return true;
  },
  form: (ctx) => {
    const task = ctx.entity?.data as { title?: string; description?: string } | undefined;

    return {
      fields: [
        {
          name: 'title',
          label: 'Title',
          type: 'text',
          schema: z.string().min(1).max(200),
          defaultValue: task?.title ?? '',
          required: true,
        },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          schema: z.string().max(5000).optional(),
          defaultValue: task?.description ?? '',
        },
      ],
      submitLabel: 'Save Changes',
    };
  },
  execute: async ({ formData, context }) => {
    const taskId = context.entity?.id;

    if (!taskId) {
      return {
        success: false,
        message: 'No task selected',
      };
    }

    // TODO: Integrate with actual API
    console.log('[EditTask] Updating task:', taskId, formData);

    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      success: true,
      message: 'Task updated',
      invalidate: ['tasks', taskId],
    };
  },
};

/**
 * Delete task action.
 *
 * Only available when viewing a task. Shows a confirmation before
 * deleting (handled by the form with a confirmation checkbox).
 */
export const deleteTaskAction: ExecutableAction = {
  type: 'action',
  id: 'delete-task',
  label: 'Delete Task',
  icon: Trash2,
  category: 'entity',
  keywords: ['remove', 'trash'],
  priority: 10,
  shortcut: {
    id: 'delete-task',
    keys: 'd',
    scope: 'global',
    allowInInput: false,
  },
  isAvailable: (ctx) => {
    if (ctx.entity?.type !== 'task') {
      return false;
    }
    return true;
  },
  form: (ctx) => {
    const task = ctx.entity?.data as { title?: string } | undefined;

    return {
      fields: [
        {
          name: 'confirm',
          label: `Delete "${task?.title ?? 'this task'}"?`,
          type: 'checkbox',
          description: 'This action cannot be undone.',
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
    const taskId = context.entity?.id;

    if (!taskId) {
      return {
        success: false,
        message: 'No task selected',
      };
    }

    if (!formData?.confirm) {
      return {
        success: false,
        message: 'Deletion not confirmed',
      };
    }

    // TODO: Integrate with actual API
    console.log('[DeleteTask] Deleting task:', taskId);

    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      success: true,
      message: 'Task deleted',
      invalidate: ['tasks'],
      navigateTo: '/tasks',
    };
  },
};

/**
 * Complete task action.
 *
 * Quick action to mark the current task as complete. No form needed.
 */
export const completeTaskAction: ExecutableAction = {
  type: 'action',
  id: 'complete-task',
  label: 'Complete Task',
  icon: CheckCircle2,
  category: 'entity',
  keywords: ['done', 'finish', 'check'],
  priority: 80,
  shortcut: {
    id: 'complete-task',
    keys: 'x',
    scope: 'global',
    allowInInput: false,
  },
  isAvailable: (ctx) => {
    if (ctx.entity?.type !== 'task') {
      return false;
    }

    // Check if already completed
    const task = ctx.entity.data as { status?: string } | undefined;
    if (task?.status === 'completed') {
      return 'Task is already completed';
    }

    return true;
  },
  execute: async ({ context }) => {
    const taskId = context.entity?.id;

    if (!taskId) {
      return {
        success: false,
        message: 'No task selected',
      };
    }

    // TODO: Integrate with actual API
    console.log('[CompleteTask] Completing task:', taskId);

    await new Promise((resolve) => setTimeout(resolve, 300));

    return {
      success: true,
      message: 'Task completed!',
      invalidate: ['tasks', taskId],
    };
  },
};

/**
 * Tasks action group.
 *
 * Groups all task-related actions under a "Tasks" category for
 * hierarchical navigation in the palette.
 */
export const tasksGroup: ActionGroup = {
  type: 'group',
  id: 'tasks-group',
  label: 'Tasks',
  icon: CheckSquare,
  category: 'create',
  keywords: ['task', 'todo', 'work'],
  children: [createTaskAction, editTaskAction, completeTaskAction, deleteTaskAction],
};

/**
 * All task actions (flat list).
 */
export const taskActions: Action[] = [
  createTaskAction,
  editTaskAction,
  completeTaskAction,
  deleteTaskAction,
];
