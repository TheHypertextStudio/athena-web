/**
 * Asana data importer.
 *
 * Supports importing tasks from Asana JSON/CSV export format.
 *
 * @packageDocumentation
 */

import type { ImportedTask } from './types.js';

/**
 * Asana task structure from JSON export.
 */
interface AsanaTask {
  gid?: string;
  name?: string;
  notes?: string;
  html_notes?: string;
  completed?: boolean;
  completed_at?: string;
  due_on?: string;
  due_at?: string;
  start_on?: string;
  start_at?: string;
  created_at?: string;
  modified_at?: string;
  tags?: { gid?: string; name?: string }[];
  memberships?: {
    project?: { gid?: string; name?: string };
    section?: { gid?: string; name?: string };
  }[];
  custom_fields?: {
    gid?: string;
    name?: string;
    type?: string;
    text_value?: string;
    number_value?: number;
    enum_value?: { gid?: string; name?: string };
  }[];
  parent?: { gid?: string; name?: string };
  num_subtasks?: number;
  assignee?: { gid?: string; name?: string; email?: string };
  followers?: { gid?: string; name?: string }[];
}

/**
 * Asana full export structure.
 */
interface AsanaExport {
  data?: AsanaTask[];
}

/**
 * Asana CSV row structure.
 */
interface AsanaCsvRow {
  'Task ID'?: string;
  'Created At'?: string;
  'Completed At'?: string;
  'Last Modified'?: string;
  Name?: string;
  Assignee?: string;
  'Assignee Email'?: string;
  'Start Date'?: string;
  'Due Date'?: string;
  Tags?: string;
  Notes?: string;
  Projects?: string;
  'Parent Task'?: string;
}

/**
 * Parse and normalize Asana export data.
 */
export function parseAsanaExport(data: unknown): ImportedTask[] {
  const tasks: ImportedTask[] = [];

  // Handle JSON array of tasks
  if (Array.isArray(data)) {
    for (const item of data) {
      // Check if it's CSV format (has 'Name' key instead of 'name')
      if ('Name' in (item as Record<string, unknown>)) {
        const task = parseCsvRow(item as AsanaCsvRow);
        if (task) tasks.push(task);
      } else {
        const task = parseTask(item as AsanaTask);
        if (task) tasks.push(task);
      }
    }
    return tasks;
  }

  // Handle wrapped JSON format { data: [...] }
  const export_ = data as AsanaExport;
  if (export_.data && Array.isArray(export_.data)) {
    for (const item of export_.data) {
      const task = parseTask(item);
      if (task) tasks.push(task);
    }
  }

  return tasks;
}

function parseTask(item: AsanaTask): ImportedTask | null {
  if (!item.name) return null;

  // Parse due date
  let deadline: Date | undefined;
  if (item.due_at) {
    deadline = new Date(item.due_at);
  } else if (item.due_on) {
    deadline = new Date(item.due_on);
  }

  // Extract tags
  const tags = item.tags?.map((t) => t.name).filter((n): n is string => !!n);

  // Extract project name from memberships
  let projectName: string | undefined;
  if (item.memberships && item.memberships.length > 0) {
    projectName = item.memberships[0]?.project?.name;
  }

  // Try to extract priority from custom fields
  let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
  if (item.custom_fields) {
    for (const field of item.custom_fields) {
      const fieldName = field.name?.toLowerCase();
      if (fieldName === 'priority' || fieldName === 'importance') {
        const value = field.enum_value?.name?.toLowerCase() ?? field.text_value?.toLowerCase();
        if (value?.includes('urgent') || value?.includes('critical')) {
          priority = 'urgent';
        } else if (value?.includes('high')) {
          priority = 'high';
        } else if (value?.includes('low')) {
          priority = 'low';
        }
      }
    }
  }

  return {
    externalId: item.gid,
    title: item.name,
    description: item.notes ?? item.html_notes?.replace(/<[^>]*>/g, ''),
    priority,
    deadline,
    status: item.completed ? 'completed' : 'pending',
    tags,
    projectName,
    metadata: {
      source: 'asana',
      parentId: item.parent?.gid,
      completedAt: item.completed_at ? new Date(item.completed_at) : undefined,
      addedAt: item.created_at ? new Date(item.created_at) : undefined,
      assignee: item.assignee?.email ?? item.assignee?.name,
      numSubtasks: item.num_subtasks,
    },
  };
}

function parseCsvRow(row: AsanaCsvRow): ImportedTask | null {
  const name = row.Name;
  if (!name) return null;

  // Parse due date
  let deadline: Date | undefined;
  const dueDate = row['Due Date'];
  if (dueDate) {
    deadline = new Date(dueDate);
  }

  // Parse tags (comma-separated)
  let tags: string[] | undefined;
  const tagsStr = row.Tags;
  if (tagsStr) {
    tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // Parse project
  let projectName: string | undefined;
  const projectsValue = row.Projects;
  if (projectsValue) {
    // Take first project if multiple
    projectName = projectsValue.split(',')[0]?.trim();
  }

  // Determine status
  const status = row['Completed At'] ? 'completed' : 'pending';

  return {
    externalId: row['Task ID'],
    title: name,
    description: row.Notes,
    priority: 'medium',
    deadline,
    status,
    tags,
    projectName,
    metadata: {
      source: 'asana',
      parentId: row['Parent Task'],
      completedAt: row['Completed At'] ? new Date(row['Completed At']) : undefined,
      addedAt: row['Created At'] ? new Date(row['Created At']) : undefined,
      assignee: row['Assignee Email'] ?? row.Assignee,
    },
  };
}

/**
 * Validate that data is a valid Asana export.
 */
export function isAsanaExport(data: unknown): boolean {
  if (Array.isArray(data)) {
    if (data.length === 0) return true;
    const first: unknown = data[0];
    // JSON format has 'name' or 'gid', CSV format has 'Name'
    if (typeof first !== 'object' || first === null) return false;
    return 'name' in first || 'gid' in first || 'Name' in first;
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    return 'data' in obj && Array.isArray(obj['data']);
  }

  return false;
}
