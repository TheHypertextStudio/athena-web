'use client';

/**
 * The per-row "sort it" quick-action menu for the Triage queue — a styled `@docket/ui`
 * DropdownMenu (never a bare `<select>`).
 *
 * @remarks
 * Triage is a holding pen: every row exists *because* it has no project and no program, so
 * the one job here is to send it onward. This menu is that single affordance. It opens off a
 * calm `ghost` icon trigger (an {@link Ellipsis}) and offers the three ways to clear an item:
 *
 * - **Move to a {@link FolderKanban | project}** — a submenu of the org's projects; choosing
 *   one PATCHes the task's `projectId`, which removes it from Triage.
 * - **Send to a {@link Target | program}** — a submenu of the org's programs; choosing one
 *   PATCHes the task's `programId`, which likewise removes it from Triage.
 * - **Dismiss** — archive the task (a destructive item) when it is noise rather than work.
 *
 * Entity nouns ("project"/"program") are vocabulary-resolved by the caller and passed in as
 * `projectNoun` / `programNoun` so org skins apply. The trigger's `onClick` stops propagation
 * so opening the menu never also opens the underlying task row. Submenus are disabled with an
 * explanatory item when the org has no projects/programs to sort into yet.
 */
import { Ellipsis, FolderKanban, Target, XCircle } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** A pickable destination (project or program) in the sort submenus. */
export interface TriageDestination {
  /** The destination's stable id. */
  id: string;
  /** The destination's display name. */
  name: string;
}

/** Props for {@link TriageActions}. */
export interface TriageActionsProps {
  /** The org's projects, offered as move-to destinations. */
  projects: readonly TriageDestination[];
  /** The org's programs, offered as send-to destinations. */
  programs: readonly TriageDestination[];
  /** Vocabulary-resolved singular noun for a project (e.g. "Project"). */
  projectNoun: string;
  /** Vocabulary-resolved singular noun for a program (e.g. "Program"). */
  programNoun: string;
  /** Whether a mutation for this row is in flight (disables the trigger). */
  busy?: boolean;
  /** Assign the task to the project with this id. */
  onAssignProject: (projectId: string) => void;
  /** Send the task to the program with this id. */
  onAssignProgram: (programId: string) => void;
  /** Dismiss (archive) the task out of the queue. */
  onDismiss: () => void;
}

/**
 * The row's sort-it menu: move to a project, send to a program, or dismiss.
 *
 * @example
 * ```tsx
 * <TriageActions
 *   projects={projects}
 *   programs={programs}
 *   projectNoun="Project"
 *   programNoun="Program"
 *   onAssignProject={(id) => void sortToProject(task.id, id)}
 *   onAssignProgram={(id) => void sortToProgram(task.id, id)}
 *   onDismiss={() => void dismiss(task.id)}
 * />
 * ```
 */
export function TriageActions({
  projects,
  programs,
  projectNoun,
  programNoun,
  busy = false,
  onAssignProject,
  onAssignProgram,
  onDismiss,
}: TriageActionsProps): JSX.Element {
  return (
    <DropdownMenu>
      {/*
        Tooltip and DropdownMenu both target the same icon-only button: nest both triggers with
        `asChild` so their props merge onto the one Button — the glyph names itself on hover/focus,
        and clicking still opens the sort menu.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Sort this item"
              disabled={busy}
              onClick={(event) => {
                // Keep opening the menu from also activating the row underneath it.
                event.stopPropagation();
              }}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Sort this item</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-[14rem]"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <DropdownMenuLabel>Sort this item</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderKanban className="h-4 w-4" />
            Move to {projectNoun.toLowerCase()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-[12rem] overflow-y-auto">
            {projects.length > 0 ? (
              projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onSelect={() => {
                    onAssignProject(project.id);
                  }}
                >
                  <span className="truncate">{project.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                No {projectNoun.toLowerCase()} to move into yet
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Target className="h-4 w-4" />
            Send to {programNoun.toLowerCase()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-[12rem] overflow-y-auto">
            {programs.length > 0 ? (
              programs.map((program) => (
                <DropdownMenuItem
                  key={program.id}
                  onSelect={() => {
                    onAssignProgram(program.id);
                  }}
                >
                  <span className="truncate">{program.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                No {programNoun.toLowerCase()} to send to yet
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            onDismiss();
          }}
        >
          <XCircle className="h-4 w-4" />
          Dismiss
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
