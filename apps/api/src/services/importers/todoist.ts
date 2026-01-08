/**
 * Todoist data importer.
 *
 * Supports importing tasks from Todoist JSON export format.
 *
 * @packageDocumentation
 */

import type { ImportedTask } from './types.js';

/**
 * Todoist task structure from JSON export.
 */
interface TodoistTask {
  id?: string | number;
  content?: string;
  description?: string;
  priority?: number; // 1 = urgent, 2 = high, 3 = medium, 4 = low (inverted)
  due?: {
    date?: string;
    datetime?: string;
    string?: string;
    timezone?: string;
    is_recurring?: boolean;
    recurring_string?: string;
  };
  labels?: string[];
  project_id?: string | number;
  section_id?: string | number;
  parent_id?: string | number;
  child_order?: number;
  is_completed?: boolean;
  completed_at?: string;
  added_at?: string;
  added_by_uid?: string | number;
  responsible_uid?: string | number;
  checked?: boolean;
}

/**
 * Todoist project structure from JSON export.
 */
interface TodoistProject {
  id?: string | number;
  name?: string;
  color?: string;
  parent_id?: string | number;
  child_order?: number;
  is_favorite?: boolean;
  is_archived?: boolean;
  is_deleted?: boolean;
}

/**
 * Todoist full backup structure.
 */
interface TodoistBackup {
  items?: TodoistTask[];
  projects?: TodoistProject[];
  labels?: { id?: string | number; name?: string }[];
  sections?: { id?: string | number; name?: string; project_id?: string | number }[];
}

/**
 * Parse and normalize Todoist export data.
 */
export function parseTodoistExport(data: unknown): ImportedTask[] {
  const tasks: ImportedTask[] = [];

  // Handle array of tasks (simple export)
  if (Array.isArray(data)) {
    for (const item of data) {
      const task = parseTask(item as TodoistTask);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  // Handle full backup format
  const backup = data as TodoistBackup;

  // Build lookup maps for projects and labels
  const projectMap = new Map<string | number, string>();
  if (backup.projects) {
    for (const project of backup.projects) {
      if (project.id && project.name) {
        projectMap.set(project.id, project.name);
      }
    }
  }

  const labelMap = new Map<string | number, string>();
  if (backup.labels) {
    for (const label of backup.labels) {
      if (label.id && label.name) {
        labelMap.set(label.id, label.name);
      }
    }
  }

  // Parse tasks
  if (backup.items) {
    for (const item of backup.items) {
      const task = parseTask(item, projectMap, labelMap);
      if (task) tasks.push(task);
    }
  }

  return tasks;
}

function parseTask(
  item: TodoistTask,
  projectMap?: Map<string | number, string>,
  labelMap?: Map<string | number, string>,
): ImportedTask | null {
  if (!item.content) return null;

  // Map Todoist priority (1=urgent to 4=low) to our format
  const priorityMap: Record<number, 'low' | 'medium' | 'high' | 'urgent'> = {
    1: 'urgent',
    2: 'high',
    3: 'medium',
    4: 'low',
  };

  // Parse due date
  let deadline: Date | undefined;
  if (item.due) {
    if (item.due.datetime) {
      deadline = new Date(item.due.datetime);
    } else if (item.due.date) {
      deadline = new Date(item.due.date);
    }
  }

  // Resolve labels to tag names
  let tags: string[] | undefined;
  if (item.labels && item.labels.length > 0) {
    if (labelMap && labelMap.size > 0) {
      tags = item.labels.map((labelId) => labelMap.get(labelId) ?? labelId).filter(Boolean);
    } else {
      // Labels might be directly the names
      tags = [...item.labels];
    }
  }

  // Resolve project name
  let projectName: string | undefined;
  if (item.project_id && projectMap) {
    projectName = projectMap.get(item.project_id);
  }

  return {
    externalId: item.id ? String(item.id) : undefined,
    title: item.content,
    description: item.description,
    priority: priorityMap[item.priority ?? 4] ?? 'medium',
    deadline,
    status: item.is_completed || item.checked ? 'completed' : 'pending',
    tags,
    projectName,
    metadata: {
      source: 'todoist',
      parentId: item.parent_id ? String(item.parent_id) : undefined,
      childOrder: item.child_order,
      recurrence: item.due?.recurring_string,
      completedAt: item.completed_at ? new Date(item.completed_at) : undefined,
      addedAt: item.added_at ? new Date(item.added_at) : undefined,
    },
  };
}

/**
 * Validate that data is a valid Todoist export.
 */
export function isTodoistExport(data: unknown): boolean {
  if (Array.isArray(data)) {
    // Simple array - check if items look like Todoist tasks
    if (data.length === 0) return true;
    const first: unknown = data[0];
    if (typeof first !== 'object' || first === null) return false;
    return 'content' in first;
  }

  if (typeof data === 'object' && data !== null) {
    // Full backup - check for known Todoist keys
    const obj = data as Record<string, unknown>;
    return 'items' in obj || 'projects' in obj || 'labels' in obj;
  }

  return false;
}
