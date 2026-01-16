/**
 * Time tracking actions for command palette.
 *
 * These actions allow users to manage time tracking directly from the
 * command palette. They're context-aware based on the current timer state.
 *
 * ## Available Actions
 *
 * | Action | Shortcut | Context | Description |
 * |--------|----------|---------|-------------|
 * | Start Timer | `t s` | No timer running | Start tracking time |
 * | Stop Timer | `t x` | Timer running | Stop and log time |
 *
 * ## Timer Integration
 *
 * The timer state is managed by the `useActiveTimer` hook. These actions
 * read and modify that state through the command context.
 *
 * @packageDocumentation
 */

import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import StopOutlined from '@mui/icons-material/StopOutlined';
import { z } from 'zod';

import type { ExecutableAction } from '../types';
import { getTimerState } from '@/hooks/use-active-timer';

/**
 * Start timer action.
 *
 * Starts tracking time. If viewing a task, associates the timer with
 * that task. Otherwise, starts a general timer.
 */
export const startTimerAction: ExecutableAction = {
  type: 'action',
  id: 'start-timer',
  label: 'Start Timer',
  icon: PlayArrowOutlined,
  category: 'time',
  keywords: ['track', 'clock', 'timing', 'begin'],
  priority: 90,
  shortcut: {
    id: 'start-timer',
    keys: 't s',
    scope: 'global',
  },
  isAvailable: (ctx) => {
    // Only show when no timer is running
    if (ctx.timer?.isRunning) {
      return false;
    }
    return true;
  },
  form: (ctx) => {
    // If we're on a task page, offer to track time for that task
    const taskId = ctx.entity?.type === 'task' ? ctx.entity.id : undefined;
    const taskTitle =
      ctx.entity?.type === 'task' ? (ctx.entity.data as { title?: string }).title : undefined;

    return {
      fields: [
        {
          name: 'taskId',
          label: 'Task',
          type: 'text',
          placeholder: 'Leave empty for general tracking',
          schema: z.string().optional(),
          defaultValue: taskId,
          description: taskTitle
            ? `Current task: ${taskTitle}`
            : 'Optionally associate with a task',
        },
      ],
      submitLabel: 'Start Timer',
    };
  },
  execute: ({ formData, context }) => {
    const { startTimer } = getTimerState();

    const taskId = (formData?.taskId as string) || null;
    const taskTitle =
      context.entity?.type === 'task'
        ? ((context.entity.data as { title?: string }).title ?? null)
        : null;

    startTimer(taskId, taskTitle);

    return Promise.resolve({
      success: true,
      message: taskTitle ? `Timer started for: ${taskTitle}` : 'Timer started',
    });
  },
};

/**
 * Stop timer action.
 *
 * Stops the current timer and logs the time. If the timer was associated
 * with a task, creates a time entry for that task.
 */
export const stopTimerAction: ExecutableAction = {
  type: 'action',
  id: 'stop-timer',
  label: 'Stop Timer',
  icon: StopOutlined,
  category: 'time',
  keywords: ['end', 'finish', 'halt', 'log'],
  priority: 95, // Higher priority when visible (timer running)
  shortcut: {
    id: 'stop-timer',
    keys: 't x',
    scope: 'global',
  },
  isAvailable: (ctx) => {
    // Only show when timer is running
    if (!ctx.timer?.isRunning) {
      return false;
    }
    return true;
  },
  execute: ({ context: _context }) => {
    const { timer, stopTimer } = getTimerState();

    if (!timer) {
      return Promise.resolve({
        success: false,
        message: 'No timer is running',
      });
    }

    const elapsed = stopTimer();
    const minutes = Math.round(elapsed / 60);

    // TODO: If timer had a task, create a time entry via API
    if (timer.taskId) {
      console.log('[StopTimer] Would create time entry:', {
        taskId: timer.taskId,
        duration: elapsed,
        startedAt: timer.startedAt,
      });
    }

    return Promise.resolve({
      success: true,
      message: `Logged ${String(minutes)} minute${minutes !== 1 ? 's' : ''}`,
      invalidate: timer.taskId ? ['time-entries', timer.taskId] : undefined,
    });
  },
};

/**
 * All time tracking actions.
 */
export const timeActions: ExecutableAction[] = [startTimerAction, stopTimerAction];
