/**
 * Trello data importer.
 *
 * Supports importing tasks from Trello JSON export format.
 *
 * @packageDocumentation
 */

import type { ImportedTask } from './types.js';

/**
 * Trello card structure from JSON export.
 */
interface TrelloCard {
  id?: string;
  name?: string;
  desc?: string;
  closed?: boolean;
  pos?: number;
  due?: string;
  dueComplete?: boolean;
  dateLastActivity?: string;
  idBoard?: string;
  idList?: string;
  idLabels?: string[];
  idChecklists?: string[];
  idMembers?: string[];
  labels?: {
    id?: string;
    name?: string;
    color?: string;
  }[];
  badges?: {
    votes?: number;
    viewingMemberVoted?: boolean;
    attachments?: number;
    checkItems?: number;
    checkItemsChecked?: number;
    comments?: number;
    description?: boolean;
    due?: string;
    dueComplete?: boolean;
    start?: string;
  };
  checklists?: {
    id?: string;
    name?: string;
    checkItems?: {
      id?: string;
      name?: string;
      state?: 'complete' | 'incomplete';
      pos?: number;
    }[];
  }[];
}

/**
 * Trello list structure.
 */
interface TrelloList {
  id?: string;
  name?: string;
  closed?: boolean;
  pos?: number;
}

/**
 * Trello board export structure.
 */
interface TrelloBoard {
  id?: string;
  name?: string;
  desc?: string;
  closed?: boolean;
  cards?: TrelloCard[];
  lists?: TrelloList[];
  labels?: {
    id?: string;
    name?: string;
    color?: string;
  }[];
  checklists?: {
    id?: string;
    name?: string;
    idBoard?: string;
    idCard?: string;
    checkItems?: {
      id?: string;
      name?: string;
      state?: 'complete' | 'incomplete';
      pos?: number;
    }[];
  }[];
}

/**
 * Parse and normalize Trello export data.
 */
export function parseTrelloExport(data: unknown): ImportedTask[] {
  const tasks: ImportedTask[] = [];

  // Handle array of cards (simple export)
  if (Array.isArray(data)) {
    for (const item of data) {
      const task = parseCard(item as TrelloCard);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  // Handle full board export
  const board = data as TrelloBoard;

  // Build lookup maps
  const listMap = new Map<string, string>();
  if (board.lists) {
    for (const list of board.lists) {
      if (list.id && list.name) {
        listMap.set(list.id, list.name);
      }
    }
  }

  const labelMap = new Map<string, { name?: string; color?: string }>();
  if (board.labels) {
    for (const label of board.labels) {
      if (label.id) {
        labelMap.set(label.id, { name: label.name, color: label.color });
      }
    }
  }

  // Build checklist map for cards that don't have embedded checklists
  const checklistMap = new Map<string, TrelloBoard['checklists']>();
  if (board.checklists) {
    for (const checklist of board.checklists) {
      if (checklist.idCard) {
        if (!checklistMap.has(checklist.idCard)) {
          checklistMap.set(checklist.idCard, []);
        }
        checklistMap.get(checklist.idCard)?.push(checklist);
      }
    }
  }

  // Parse cards
  if (board.cards) {
    for (const card of board.cards) {
      const task = parseCard(card, listMap, labelMap, checklistMap.get(card.id ?? ''));
      if (task) {
        // Add board name as project
        task.projectName = board.name;
        tasks.push(task);
      }
    }
  }

  return tasks;
}

function parseCard(
  card: TrelloCard,
  listMap?: Map<string, string>,
  labelMap?: Map<string, { name?: string; color?: string }>,
  boardChecklists?: TrelloBoard['checklists'],
): ImportedTask | null {
  if (!card.name) return null;

  // Parse due date
  let deadline: Date | undefined;
  if (card.due) {
    deadline = new Date(card.due);
  }

  // Resolve labels
  let tags: string[] | undefined;
  if (card.labels && card.labels.length > 0) {
    // Card has embedded labels
    tags = card.labels.map((l) => l.name ?? l.color ?? '').filter(Boolean);
  } else if (card.idLabels && card.idLabels.length > 0 && labelMap) {
    // Need to resolve label IDs
    tags = card.idLabels
      .map((id) => labelMap.get(id)?.name ?? labelMap.get(id)?.color ?? '')
      .filter(Boolean);
  }

  // Determine status based on list name or card state
  let status: 'pending' | 'in_progress' | 'completed' | 'cancelled' = 'pending';
  if (card.closed || card.dueComplete) {
    status = 'completed';
  } else if (card.idList && listMap) {
    const listName = listMap.get(card.idList)?.toLowerCase();
    if (listName) {
      if (
        listName.includes('done') ||
        listName.includes('complete') ||
        listName.includes('finished')
      ) {
        status = 'completed';
      } else if (
        listName.includes('progress') ||
        listName.includes('doing') ||
        listName.includes('active')
      ) {
        status = 'in_progress';
      } else if (listName.includes('cancel') || listName.includes('archive')) {
        status = 'cancelled';
      }
    }
  }

  // Derive priority from label colors (red = urgent, orange = high, yellow = medium, green/blue = low)
  let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
  const labelColors = card.labels?.map((l) => l.color) ?? [];
  if (labelColors.includes('red')) {
    priority = 'urgent';
  } else if (labelColors.includes('orange')) {
    priority = 'high';
  } else if (labelColors.includes('green') || labelColors.includes('blue')) {
    priority = 'low';
  }

  // Build description with checklist items
  let description = card.desc ?? '';
  const checklists = card.checklists ?? boardChecklists ?? [];
  if (checklists.length > 0) {
    for (const checklist of checklists) {
      if (checklist.checkItems && checklist.checkItems.length > 0) {
        description += `\n\n## ${checklist.name ?? 'Checklist'}\n`;
        for (const item of checklist.checkItems.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))) {
          const checkbox = item.state === 'complete' ? '[x]' : '[ ]';
          description += `- ${checkbox} ${item.name ?? ''}\n`;
        }
      }
    }
  }

  // Get list name as section
  let sectionName: string | undefined;
  if (card.idList && listMap) {
    sectionName = listMap.get(card.idList);
  }

  return {
    externalId: card.id,
    title: card.name,
    description: description.trim() || undefined,
    priority,
    deadline,
    status,
    tags,
    metadata: {
      source: 'trello',
      childOrder: card.pos,
      section: sectionName,
      checklistProgress: card.badges
        ? `${String(card.badges.checkItemsChecked ?? 0)}/${String(card.badges.checkItems ?? 0)}`
        : undefined,
      attachmentCount: card.badges?.attachments,
      commentCount: card.badges?.comments,
    },
  };
}

/**
 * Validate that data is a valid Trello export.
 */
export function isTrelloExport(data: unknown): boolean {
  if (Array.isArray(data)) {
    if (data.length === 0) return true;
    const first = data[0] as Record<string, unknown>;
    // Trello cards have 'idBoard' or 'idList'
    return (
      typeof first === 'object' && ('idBoard' in first || 'idList' in first || 'badges' in first)
    );
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    // Board export has 'cards' and/or 'lists' arrays
    return 'cards' in obj || 'lists' in obj;
  }

  return false;
}
