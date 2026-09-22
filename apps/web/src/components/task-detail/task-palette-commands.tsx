'use client';

/**
 * The task page's relationship actions in the command palette, under "This task".
 *
 * @remarks
 * Each command opens the same control the page shows for it: the inline subtask composer, or a
 * task search for an existing subtask, a blocker, a blocked task, a related task, or the parent.
 * The Subtasks and Relations sections live on the Overview tab, so those commands switch to it
 * first. "Set parent" is offered only while the properties sidebar is docked, because that is
 * where its picker is on screen; on a narrow pane the parent is a chip in the masthead row's
 * overflow menu. Rendered inside the layout's metadata slot so it can read the sidebar's state.
 * Nothing is published to a viewer who cannot edit.
 */
import { ArrowRight, Link, Plus, Workflow } from '@docket/ui/icons';
import { type JSX, useMemo } from 'react';

import { usePublishPageCommands } from '@/components/command-palette/page-commands';
import type { PaletteItem } from '@/components/command-palette/types';
import { useEntityDetailAside } from '@/components/views/entity-detail-layout';

import type { TaskTab } from './task-masthead-slots';
import { type TaskRelationCommand, useTaskRelationCommands } from './task-relation-commands';

/** One command: what it opens, how it reads, and its glyph. */
interface CommandSpec {
  readonly command: TaskRelationCommand;
  readonly label: string;
  readonly icon: PaletteItem['icon'];
  readonly keywords: readonly string[];
}

const OVERVIEW_COMMANDS: readonly CommandSpec[] = [
  { command: 'newSubtask', label: 'Add subtask', icon: Plus, keywords: ['child', 'checklist'] },
  {
    command: 'existingSubtask',
    label: 'Add existing task as subtask',
    icon: Link,
    keywords: ['child', 'attach', 'nest'],
  },
  {
    command: 'blockedBy',
    label: 'Add blocker',
    icon: ArrowRight,
    keywords: ['blocked by', 'dependency', 'depends on', 'waits on'],
  },
  {
    command: 'blocking',
    label: 'Add blocked task',
    icon: ArrowRight,
    keywords: ['blocks', 'dependency', 'dependent'],
  },
  { command: 'related', label: 'Add related task', icon: Link, keywords: ['relate', 'link'] },
];

const PARENT_COMMAND: CommandSpec = {
  command: 'parent',
  label: 'Set parent task',
  icon: Workflow,
  keywords: ['move under', 'nest', 'parent'],
};

/** Props for {@link TaskPaletteCommands}. */
export interface TaskPaletteCommandsProps {
  readonly canEdit: boolean;
  readonly tab: TaskTab;
  readonly onTabChange: (tab: TaskTab) => void;
}

/**
 * Publish the task page's relationship commands while the page is mounted.
 *
 * @param props - See {@link TaskPaletteCommandsProps}.
 * @returns nothing visible.
 */
export function TaskPaletteCommands({
  canEdit,
  tab,
  onTabChange,
}: TaskPaletteCommandsProps): JSX.Element | null {
  const { setActive } = useTaskRelationCommands();
  const { docked } = useEntityDetailAside();
  const commands = useMemo(() => {
    const specs = canEdit ? [...OVERVIEW_COMMANDS, ...(docked ? [PARENT_COMMAND] : [])] : [];
    const items = specs.map((spec): PaletteItem => ({
      id: `task-page:${spec.command}`,
      section: 'page',
      label: spec.label,
      icon: spec.icon,
      keywords: spec.keywords,
      run: () => {
        if (spec.command !== 'parent' && tab !== 'overview') onTabChange('overview');
        // Open after the palette has closed, so its dismissal cannot close the control too.
        window.setTimeout(() => {
          setActive(spec.command);
        }, 0);
      },
    }));
    return { label: 'This task', items };
  }, [canEdit, docked, onTabChange, setActive, tab]);
  usePublishPageCommands(commands);
  return null;
}
