'use client';

/**
 * The grouping control for the cycle detail's committed-task list — a styled `@docket/ui`
 * DropdownMenu (never a bare `<select>`).
 *
 * @remarks
 * A cycle's committed tasks can be grouped by their containing {@link useVocabulary | project}
 * or by their {@link useVocabulary | program} (matching the `groupBy` query the
 * `…/cycles/:id/tasks` read accepts). The trigger reads as a calm, bordered control with a
 * leading filter glyph and a focus ring; the active axis carries a check. Entity nouns are
 * vocabulary-resolved by the caller so an org's skin (e.g. "Workstream" for project) shows
 * through.
 */
import type { CycleTaskGroupBy } from '@docket/types';
import { ChevronDown, Filter } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link GroupByMenu}. */
export interface GroupByMenuProps {
  /** The active grouping axis. */
  value: CycleTaskGroupBy;
  /** Called with the newly selected axis. */
  onChange: (groupBy: CycleTaskGroupBy) => void;
  /** The (vocabulary-resolved) singular project noun. */
  projectNoun: string;
  /** The (vocabulary-resolved) singular program noun. */
  programNoun: string;
}

/**
 * The cycle task list's group-by control.
 *
 * @example
 * ```tsx
 * <GroupByMenu value={groupBy} onChange={setGroupBy} projectNoun="Project" programNoun="Program" />
 * ```
 */
export function GroupByMenu({
  value,
  onChange,
  projectNoun,
  programNoun,
}: GroupByMenuProps): JSX.Element {
  const label = value === 'project' ? projectNoun : programNoun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-4 w-4" />
          <span>Group by {label.toLowerCase()}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        <DropdownMenuLabel>Group tasks by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as CycleTaskGroupBy);
          }}
        >
          <DropdownMenuRadioItem value="project">{projectNoun}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="program">{programNoun}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
