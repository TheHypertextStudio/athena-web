/**
 * Navigation actions for command palette.
 *
 * These actions allow users to quickly navigate to different pages in the app.
 * They're among the most frequently used actions and are optimized for speed.
 *
 * ## Available Actions
 *
 * | Action | Shortcut | Description |
 * |--------|----------|-------------|
 * | Go to Dashboard | `g d` | Navigate to the dashboard |
 * | Go to Agenda | `g a` | Navigate to the agenda view |
 * | Go to Tasks | `g t` | Navigate to tasks list |
 * | Go to Projects | `g p` | Navigate to projects list |
 * | Go to Initiatives | `g i` | Navigate to initiatives |
 * | Go to Events | `g e` | Navigate to calendar/events |
 * | Go to Moments | `g m` | Navigate to moments journal |
 * | Go to Settings | `g s` | Navigate to settings |
 *
 * ## Vim-Style Shortcuts
 *
 * Navigation actions use vim-style key sequences (press `g`, then the key).
 * This allows for mnemonic shortcuts without modifier keys.
 *
 * @packageDocumentation
 */

import {
  LayoutDashboard,
  CalendarClock,
  CheckSquare,
  FolderKanban,
  Target,
  Calendar,
  BookOpen,
  Settings,
} from 'lucide-react';

import type { ExecutableAction } from '../types';

const createNavigationResult = (path: string): Promise<{ success: boolean; navigateTo: string }> =>
  Promise.resolve({ success: true, navigateTo: path });

/**
 * Navigate to dashboard action.
 *
 * The dashboard is the main landing page showing an overview of
 * tasks, projects, and upcoming events.
 */
export const goToDashboardAction: ExecutableAction = {
  type: 'action',
  id: 'go-dashboard',
  label: 'Go to Dashboard',
  icon: LayoutDashboard,
  category: 'navigation',
  keywords: ['home', 'overview', 'main'],
  priority: 100,
  shortcut: {
    id: 'go-dashboard',
    keys: 'g d',
    scope: 'global',
  },
  execute: () => createNavigationResult('/dashboard'),
};

/**
 * Navigate to agenda action.
 *
 * The agenda view shows a chronological list of tasks and events,
 * helping users plan their day.
 */
export const goToAgendaAction: ExecutableAction = {
  type: 'action',
  id: 'go-agenda',
  label: 'Go to Agenda',
  icon: CalendarClock,
  category: 'navigation',
  keywords: ['today', 'schedule', 'plan', 'daily'],
  priority: 95,
  shortcut: {
    id: 'go-agenda',
    keys: 'g a',
    scope: 'global',
  },
  execute: () => createNavigationResult('/agenda'),
};

/**
 * Navigate to tasks action.
 *
 * The tasks page shows all tasks with filtering and sorting options.
 */
export const goToTasksAction: ExecutableAction = {
  type: 'action',
  id: 'go-tasks',
  label: 'Go to Tasks',
  icon: CheckSquare,
  category: 'navigation',
  keywords: ['todos', 'work', 'items'],
  priority: 90,
  shortcut: {
    id: 'go-tasks',
    keys: 'g t',
    scope: 'global',
  },
  execute: () => createNavigationResult('/tasks'),
};

/**
 * Navigate to projects action.
 *
 * The projects page shows all projects with their status and progress.
 */
export const goToProjectsAction: ExecutableAction = {
  type: 'action',
  id: 'go-projects',
  label: 'Go to Projects',
  icon: FolderKanban,
  category: 'navigation',
  keywords: ['folders', 'groups', 'collections'],
  priority: 85,
  shortcut: {
    id: 'go-projects',
    keys: 'g p',
    scope: 'global',
  },
  execute: () => createNavigationResult('/projects'),
};

/**
 * Navigate to initiatives action.
 *
 * Initiatives are high-level goals that group multiple projects.
 */
export const goToInitiativesAction: ExecutableAction = {
  type: 'action',
  id: 'go-initiatives',
  label: 'Go to Initiatives',
  icon: Target,
  category: 'navigation',
  keywords: ['goals', 'objectives', 'okrs'],
  priority: 80,
  shortcut: {
    id: 'go-initiatives',
    keys: 'g i',
    scope: 'global',
  },
  execute: () => createNavigationResult('/initiatives'),
};

/**
 * Navigate to events/calendar action.
 *
 * The events page shows calendar events and allows scheduling.
 */
export const goToEventsAction: ExecutableAction = {
  type: 'action',
  id: 'go-events',
  label: 'Go to Events',
  icon: Calendar,
  category: 'navigation',
  keywords: ['calendar', 'meetings', 'appointments'],
  priority: 75,
  shortcut: {
    id: 'go-events',
    keys: 'g e',
    scope: 'global',
  },
  execute: () => createNavigationResult('/events'),
};

/**
 * Navigate to moments action.
 *
 * Moments is a journal/note-taking feature for capturing thoughts.
 */
export const goToMomentsAction: ExecutableAction = {
  type: 'action',
  id: 'go-moments',
  label: 'Go to Moments',
  icon: BookOpen,
  category: 'navigation',
  keywords: ['journal', 'notes', 'thoughts', 'diary'],
  priority: 70,
  shortcut: {
    id: 'go-moments',
    keys: 'g m',
    scope: 'global',
  },
  execute: () => createNavigationResult('/moments'),
};

/**
 * Navigate to settings action.
 *
 * The settings page allows users to customize their preferences.
 */
export const goToSettingsAction: ExecutableAction = {
  type: 'action',
  id: 'go-settings',
  label: 'Go to Settings',
  icon: Settings,
  category: 'navigation',
  keywords: ['preferences', 'config', 'options'],
  priority: 50,
  shortcut: {
    id: 'go-settings',
    keys: 'g s',
    scope: 'global',
  },
  execute: () => createNavigationResult('/settings'),
};

/**
 * All navigation actions.
 *
 * Export as an array for easy registration with the action registry.
 */
export const navigationActions: ExecutableAction[] = [
  goToDashboardAction,
  goToAgendaAction,
  goToTasksAction,
  goToProjectsAction,
  goToInitiativesAction,
  goToEventsAction,
  goToMomentsAction,
  goToSettingsAction,
];
