'use client';

/**
 * The associated-children panel for an Initiative detail.
 *
 * @remarks
 * An Initiative associates many-to-many with Projects (`initiative_project`) and Programs
 * (`initiative_program`); this panel makes that membership explicit and editable. It lists
 * the currently-linked Projects and Programs, each with an unlink affordance, and offers a
 * styled {@link DropdownMenu} "add" picker per kind (never a bare `<select>`) listing the
 * org's unlinked candidates. Choosing a candidate links it; the trigger reads "Linking…"
 * while a mutation is in flight, and an inline `role="alert"` surfaces any failure.
 *
 * The panel is purely a controlled view: it reports link/unlink intents up to the page,
 * which owns the RPC calls and re-reads the timeline so the roadmap + roll-up stay in sync.
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { Plus, X } from '@docket/ui/icons';
import type { JSX } from 'react';

/** A candidate or linked child (Project or Program) reduced to id + name. */
export interface AssociationItem {
  readonly id: string;
  readonly name: string;
}

/** Props for one association group (e.g. Projects, or Programs). */
interface AssociationGroupProps {
  /** Section heading (vocabulary-resolved plural noun, e.g. "Projects"). */
  title: string;
  /** Singular noun for inline copy (vocabulary-resolved, e.g. "project"). */
  noun: string;
  /** The currently-linked children. */
  linked: readonly AssociationItem[];
  /** The org's unlinked candidates (offered in the add picker). */
  candidates: readonly AssociationItem[];
  /** Whether the caller may edit associations (contribute capability). */
  canEdit: boolean;
  /** Whether a link/unlink mutation is in flight for this group. */
  busy: boolean;
  /** Link error for this group, when the last attempt failed. */
  error: string | null;
  /** Link the candidate with the given id. */
  onLink: (id: string) => void;
  /** Unlink the child with the given id. */
  onUnlink: (id: string) => void;
}

/** A single linked-children group with an add picker. */
function AssociationGroup({
  title,
  noun,
  linked,
  candidates,
  canEdit,
  busy,
  error,
  onLink,
  onUnlink,
}: AssociationGroupProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-on-surface text-sm font-semibold">
          {title}
          <span className="text-on-surface-variant ml-2 font-normal tabular-nums">
            {linked.length}
          </span>
        </h3>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || candidates.length === 0}
                aria-label={`Link a ${noun}`}
                className="h-7 gap-1 px-2"
              >
                <Plus aria-hidden="true" className="size-4" />
                {busy ? 'Linking…' : 'Link'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel>Link a {noun}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {candidates.length === 0 ? (
                <DropdownMenuItem disabled>Nothing left to link</DropdownMenuItem>
              ) : (
                candidates.map((candidate) => (
                  <DropdownMenuItem
                    key={candidate.id}
                    onSelect={() => {
                      onLink(candidate.id);
                    }}
                  >
                    <span className="truncate">{candidate.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {linked.length === 0 ? (
        <p className="text-on-surface-variant text-xs">No {noun}s linked.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {linked.map((item) => (
            <li
              key={item.id}
              className="border-outline-variant group flex items-center gap-2 rounded-md border px-2.5 py-1.5"
            >
              <span className="text-on-surface min-w-0 flex-1 truncate text-sm">{item.name}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    onUnlink(item.id);
                  }}
                  disabled={busy}
                  aria-label={`Unlink ${item.name}`}
                  className="text-on-surface-variant hover:text-destructive focus-visible:ring-ring rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Props for {@link AssociationsPanel}. */
export interface AssociationsPanelProps {
  /** Plural Program noun (vocabulary-resolved). */
  programNounPlural: string;
  /** Singular Program noun, lower-cased (vocabulary-resolved). */
  programNoun: string;
  /** Plural Project noun (vocabulary-resolved). */
  projectNounPlural: string;
  /** Singular Project noun, lower-cased (vocabulary-resolved). */
  projectNoun: string;
  /** Linked Programs. */
  linkedPrograms: readonly AssociationItem[];
  /** Unlinked Program candidates. */
  programCandidates: readonly AssociationItem[];
  /** Linked Projects. */
  linkedProjects: readonly AssociationItem[];
  /** Unlinked Project candidates. */
  projectCandidates: readonly AssociationItem[];
  /** Whether the caller may edit associations. */
  canEdit: boolean;
  /** Whether a Program link/unlink is in flight. */
  programBusy: boolean;
  /** Whether a Project link/unlink is in flight. */
  projectBusy: boolean;
  /** The last Program mutation error, if any. */
  programError: string | null;
  /** The last Project mutation error, if any. */
  projectError: string | null;
  /** Link a Program by id. */
  onLinkProgram: (id: string) => void;
  /** Unlink a Program by id. */
  onUnlinkProgram: (id: string) => void;
  /** Link a Project by id. */
  onLinkProject: (id: string) => void;
  /** Unlink a Project by id. */
  onUnlinkProject: (id: string) => void;
}

/**
 * The associated-children editor: linked Programs + Projects with add/unlink controls.
 *
 * @param props - The {@link AssociationsPanelProps}.
 * @returns the rendered panel.
 */
export function AssociationsPanel({
  programNounPlural,
  programNoun,
  projectNounPlural,
  projectNoun,
  linkedPrograms,
  programCandidates,
  linkedProjects,
  projectCandidates,
  canEdit,
  programBusy,
  projectBusy,
  programError,
  projectError,
  onLinkProgram,
  onUnlinkProgram,
  onLinkProject,
  onUnlinkProject,
}: AssociationsPanelProps): JSX.Element {
  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-on-surface-variant text-xs font-medium">Associated work</h2>
      <AssociationGroup
        title={programNounPlural}
        noun={programNoun}
        linked={linkedPrograms}
        candidates={programCandidates}
        canEdit={canEdit}
        busy={programBusy}
        error={programError}
        onLink={onLinkProgram}
        onUnlink={onUnlinkProgram}
      />
      <AssociationGroup
        title={projectNounPlural}
        noun={projectNoun}
        linked={linkedProjects}
        candidates={projectCandidates}
        canEdit={canEdit}
        busy={projectBusy}
        error={projectError}
        onLink={onLinkProject}
        onUnlink={onUnlinkProject}
      />
    </div>
  );
}
