'use client';

/**
 * `programs` — the Programs roster, shared by the List and Cards lenses on `/orgs/[orgId]/programs`.
 *
 * @remarks
 * Programs previously rendered through the dense `EntityListRow` family (the 36px "comfortable"
 * tier used by Tasks/Cycles/Teams), which read as visually smaller than the Initiatives and
 * Projects rosters even though Programs carry the same tier of information — owner, health,
 * status, and a child-work roll-up. This module instead hand-rolls the same 72px identity-row
 * grid Initiatives and Projects use (leading glyph + name + summary, then aligned status/health/
 * owner/count columns), so all three read as one product at the same visual weight.
 *
 * Programs have no per-entity customizable icon (unlike Initiatives/Projects'
 * {@link EntityDisplayOut}-backed {@link InitiativeIconPicker}) — a Program's identity is its
 * ongoing liveness, not a chosen glyph. Rather than fake a picker over a field that doesn't
 * exist, {@link ProgramGlyph} renders the same fixed mark everywhere: a neutral tonal circle
 * around `Layers` (the icon already used for Programs in the nav and empty state), sized to
 * match the customizable glyphs so the row reads at the same weight while staying honest that
 * this is a fixed, not a chosen, mark. That fixed identity is itself the "these are programs, not
 * projects" signal the roster needs.
 *
 * Both {@link ProgramRows} (List) and {@link ProgramCards} (Cards — Programs are discrete ongoing
 * units, closer to a portfolio of cards than a flat backlog) take the identical prop shape, so the
 * page can switch lenses without reshaping data. Both share one click model, copied from the
 * Initiatives treegrid row (the more complete of the app's two: a shared `dragOccurredRef` per
 * item suppresses the synthetic click a drop can dispatch, and the row/card's own `onClick` opens
 * the item unless the click landed on a nested `a`/`button` — so EditableTitle's own single/double
 * click handling, or a fallback inline `Link` when the viewer can't rename, both still win).
 */
import type { Health, ProgramOut } from '@docket/types';
import { ActorAvatar, IdentityGlyph } from '@docket/ui/components';
import { FolderKanban, Layers, ListChecks } from '@docket/ui/icons';
import { Card, Skeleton } from '@docket/ui/primitives';
import { dragSourceProps } from '@docket/ui/lib/draggable';
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import { type ComponentPropsWithoutRef, type JSX, useRef } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/programs/health';
import { ProgramStatusBadge } from '@/components/programs/program-status';
import { entityDragSource } from '@/lib/entity-drag';

/** The row view-model derived for one Program (owner + child-work roll-up). */
export interface ProgramRow {
  program: ProgramOut;
  ownerName: string | null;
  projectCount: number;
  taskCount: number;
}

/**
 * Colored-text health treatment (dot + label) — matches the Initiatives roster's health cell.
 * Kept local to this screen, mirroring how `initiatives-client.tsx` defines its own rather than
 * exporting it from the shared `programs/health` module.
 */
const HEALTH_TEXT_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-destructive',
};

/** A compact dot + colored label for a Program's health verdict, or an em dash when unset. */
function HealthLabel({ health }: { health: Health | null }): JSX.Element {
  if (!health) return <span className="text-on-surface-variant text-sm">—</span>;
  return (
    <span
      className={cn(HEALTH_TEXT_CLASS[health], 'flex items-center gap-1.5 text-sm font-medium')}
    >
      <span
        aria-hidden="true"
        className={cn(HEALTH_DOT_CLASS[health], 'size-1.5 shrink-0 rounded-full')}
      />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/**
 * The fixed Program identity glyph — a neutral {@link IdentityGlyph} circle around `Layers`.
 *
 * @remarks
 * Sized to match {@link EntityIconGlyph}'s default (40px) so a Programs roster reads at the same
 * visual weight as Initiatives/Projects, without implying a customization affordance that has no
 * backing field.
 */
function ProgramGlyph(): JSX.Element {
  return (
    <IdentityGlyph>
      <Layers className="size-5" />
    </IdentityGlyph>
  );
}

/** Shared props for one Program item, however it's rendered (row or card). */
interface ProgramItemProps {
  row: ProgramRow;
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  onOpen: (programId: string) => void;
  canRename?: boolean;
  onRename?: (programId: string, name: string) => void;
}

/** The Program name: inline-editable when the viewer can rename, else a real link (right-clickable, keyboard-reachable). */
function ProgramName({
  program,
  canRename,
  onRename,
  onOpen,
  className,
}: {
  program: ProgramOut;
  canRename?: boolean;
  onRename?: (programId: string, name: string) => void;
  onOpen: (programId: string) => void;
  className: string;
}): JSX.Element {
  if (canRename && onRename) {
    return (
      <EditableTitle
        value={program.name}
        onSave={(name) => {
          onRename(program.id, name);
        }}
        canEdit
        activate="doubleClick"
        onActivate={() => {
          onOpen(program.id);
        }}
        ariaLabel="Program name"
        className={className}
      />
    );
  }
  return (
    <Link
      href={`/orgs/${program.organizationId}/programs/${program.id}`}
      className={cn(className, 'hover:underline')}
    >
      {program.name}
    </Link>
  );
}

/** Build this item's drag source, wired to suppress the post-drop synthetic click. */
function useProgramDrag(program: ProgramOut, dragOccurredRef: { current: boolean }) {
  return dragSourceProps(
    entityDragSource(
      {
        kind: 'program',
        id: program.id,
        organizationId: program.organizationId,
        title: program.name,
      },
      {
        onDragStart: () => {
          dragOccurredRef.current = true;
        },
        onDragEnd: () => {
          // Clear on the next tick so the post-drop synthesized click (dispatched before this
          // macrotask) is still suppressed, while later genuine clicks open normally.
          window.setTimeout(() => {
            dragOccurredRef.current = false;
          }, 0);
        },
      },
    ),
  );
}

/** One 72px identity row: glyph + name/summary, then aligned status/health/owner/count columns. */
function ProgramGridRow({
  row: { program, ownerName, projectCount, taskCount },
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  onOpen,
  canRename,
  onRename,
}: ProgramItemProps): JSX.Element {
  const dragOccurredRef = useRef(false);
  const dragProps = useProgramDrag(program, dragOccurredRef);

  return (
    <div
      role="row"
      {...dragProps}
      className={cn(
        'hover:bg-surface-container-high relative grid min-h-[72px] cursor-pointer grid-cols-[minmax(22rem,1fr)_7rem_7rem_10rem_5.5rem_5.5rem] items-center rounded-lg transition-colors',
        dragProps?.className,
      )}
      onClick={(event) => {
        if (dragOccurredRef.current) return;
        if ((event.target as HTMLElement).closest('a, button')) return;
        onOpen(program.id);
      }}
    >
      <div role="gridcell" className="flex min-w-0 items-center gap-3 px-2 py-2">
        <ProgramGlyph />
        <div className="min-w-0">
          <ProgramName
            program={program}
            canRename={canRename}
            onRename={onRename}
            onOpen={onOpen}
            className="text-on-surface line-clamp-1 text-sm leading-5 font-semibold"
          />
          {program.summary ? (
            <p className="text-on-surface-variant mt-0.5 line-clamp-2 max-w-[48ch] text-xs leading-4">
              {program.summary}
            </p>
          ) : null}
        </div>
      </div>
      <div role="gridcell" className="px-3">
        <ProgramStatusBadge status={program.status} />
      </div>
      <div role="gridcell" className="px-3 whitespace-nowrap">
        <HealthLabel health={program.health ?? null} />
      </div>
      <div role="gridcell" className="flex min-w-0 items-center gap-1.5 px-3">
        {ownerName ? (
          <>
            <ActorAvatar kind="human" name={ownerName} size={20} />
            <span className="text-on-surface truncate text-sm">{ownerName}</span>
          </>
        ) : (
          <span className="text-on-surface-variant text-sm">Unowned</span>
        )}
      </div>
      <div
        role="gridcell"
        className="text-on-surface-variant flex items-center gap-1.5 px-3 text-sm tabular-nums"
      >
        <FolderKanban aria-hidden="true" className="size-4" />
        {projectCount}
        <span className="sr-only">{projectCount === 1 ? projectNoun : projectNounPlural}</span>
      </div>
      <div
        role="gridcell"
        className="text-on-surface-variant flex items-center gap-1.5 px-3 text-sm tabular-nums"
      >
        <ListChecks aria-hidden="true" className="size-4" />
        {taskCount}
        <span className="sr-only">{taskCount === 1 ? taskNoun : taskNounPlural}</span>
      </div>
    </div>
  );
}

/**
 * Props for {@link ProgramRows} and {@link ProgramCards}.
 *
 * @remarks
 * Extends the outer wrapper's own div props (`React.ComponentPropsWithoutRef<'div'>`) so a caller
 * can pass `className`, `data-*`, `id`, or an event handler straight through to the roster frame
 * without the component needing a bespoke passthrough prop for each — the same "arbitrary props
 * pass through" contract {@link ListRow} already honors by spreading `...rest`.
 */
export interface ProgramRowsProps extends ComponentPropsWithoutRef<'div'> {
  rows: readonly ProgramRow[];
  projectNoun: string;
  projectNounPlural: string;
  taskNoun: string;
  taskNounPlural: string;
  ariaLabel: string;
  onOpen: (programId: string) => void;
  /** Whether the viewer may rename a program in place (double-click the title). */
  canRename?: boolean;
  /** Persist a renamed program name. Enables inline rename when provided with `canRename`. */
  onRename?: (programId: string, name: string) => void;
}

/** Column-header widths shared by {@link ProgramRows}'s header and data rows. */
const ROW_GRID = 'grid-cols-[minmax(22rem,1fr)_7rem_7rem_10rem_5.5rem_5.5rem]';

/** The Programs roster as aligned identity rows — the List lens, matching Initiatives/Projects. */
export function ProgramRows({
  rows,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
  onOpen,
  canRename,
  onRename,
  className,
  ...rest
}: ProgramRowsProps): JSX.Element {
  const itemProps = {
    projectNoun,
    projectNounPlural,
    taskNoun,
    taskNounPlural,
    onOpen,
    canRename,
    onRename,
  };
  return (
    <div {...rest} className={cn('bg-surface-container-low relative rounded-xl p-2', className)}>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div role="grid" aria-label={ariaLabel} className="min-w-[54rem] text-sm">
          <div
            role="row"
            className={cn('text-on-surface-variant grid h-8 items-center text-xs', ROW_GRID)}
          >
            <div role="columnheader" className="px-3 pl-14 font-medium">
              Program
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Status
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Health
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Owner
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Projects
            </div>
            <div role="columnheader" className="px-3 font-medium">
              Tasks
            </div>
          </div>
          {rows.map((row) => (
            <ProgramGridRow key={row.program.id} row={row} {...itemProps} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One Program card: glyph + name + status up top, summary, then owner/health and the work roll-up. */
function ProgramCard({
  row: { program, ownerName, projectCount, taskCount },
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  onOpen,
  canRename,
  onRename,
}: ProgramItemProps): JSX.Element {
  const dragOccurredRef = useRef(false);
  const dragProps = useProgramDrag(program, dragOccurredRef);

  return (
    <Card
      role="listitem"
      {...dragProps}
      className={cn(
        'hover:bg-surface-container-high flex cursor-pointer flex-col gap-3 p-4 transition-colors',
        dragProps?.className,
      )}
      onClick={(event) => {
        if (dragOccurredRef.current) return;
        if ((event.target as HTMLElement).closest('a, button')) return;
        onOpen(program.id);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ProgramGlyph />
          <ProgramName
            program={program}
            canRename={canRename}
            onRename={onRename}
            onOpen={onOpen}
            className="text-on-surface line-clamp-1 min-w-0 text-sm leading-5 font-semibold"
          />
        </div>
        <span className="shrink-0">
          <ProgramStatusBadge status={program.status} />
        </span>
      </div>

      {program.summary ? (
        <p className="text-on-surface-variant line-clamp-2 text-xs leading-4">{program.summary}</p>
      ) : null}

      <div className="border-outline-variant/60 mt-auto flex items-center justify-between gap-2 border-t pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {ownerName ? (
            <>
              <ActorAvatar kind="human" name={ownerName} size={18} />
              <span className="text-on-surface-variant truncate text-xs">{ownerName}</span>
            </>
          ) : (
            <span className="text-on-surface-variant text-xs">Unowned</span>
          )}
        </div>
        <HealthLabel health={program.health ?? null} />
      </div>

      <div className="text-on-surface-variant flex items-center gap-4 text-xs tabular-nums">
        <span className="flex items-center gap-1.5">
          <FolderKanban aria-hidden="true" className="size-4" />
          {projectCount} {projectCount === 1 ? projectNoun : projectNounPlural}
        </span>
        <span className="flex items-center gap-1.5">
          <ListChecks aria-hidden="true" className="size-4" />
          {taskCount} {taskCount === 1 ? taskNoun : taskNounPlural}
        </span>
      </div>
    </Card>
  );
}

/**
 * The Programs roster as a grid of cards — the Cards lens. Programs are discrete ongoing units
 * (a funded area, a retainer, a recurring operation), so a card grid reads them as separate
 * things at a glance the way a flat list of rows doesn't.
 */
export function ProgramCards({
  rows,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
  onOpen,
  canRename,
  onRename,
  className,
  ...rest
}: ProgramRowsProps): JSX.Element {
  const itemProps = {
    projectNoun,
    projectNounPlural,
    taskNoun,
    taskNounPlural,
    onOpen,
    canRename,
    onRename,
  };
  return (
    <div
      {...rest}
      role="list"
      aria-label={ariaLabel}
      // Container queries, not viewport breakpoints: this grid sits inside the persistent app
      // shell's side rails, so the available width is routinely far narrower than the viewport (a
      // `xl:` viewport breakpoint fired here at a ~730px-wide container and forced 3 columns into
      // ~226px cards, truncating every title). The `(app)` route-group layout already establishes
      // the `@container` context the page shell's own padding rhythm relies on — no need to
      // redeclare it here.
      className={cn('grid grid-cols-1 gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3', className)}
    >
      {rows.map((row) => (
        <ProgramCard key={row.program.id} row={row} {...itemProps} />
      ))}
    </div>
  );
}

/** Loading placeholder: plain row-height skeleton blocks, matching the Projects/Initiatives lists. */
export function ListSkeleton(): JSX.Element {
  // placeholder: the program rows — how many programs the workspace has and each one's name,
  // status, health and rolled-up project counts. The list's heading and actions are static.
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-full" />
      ))}
    </div>
  );
}
