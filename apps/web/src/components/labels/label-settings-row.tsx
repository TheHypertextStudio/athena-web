'use client';

/**
 * One label's row on the settings page.
 *
 * @remarks
 * The row's job is to answer "what is this and is it earning its place?" — so it carries the
 * chip as it actually renders, a usage count, and where the label came from, in that order.
 * Rows separate by a tonal step rather than a rule, matching the templates settings list.
 *
 * The count is the reason a person can keep a label set small without auditing it by hand: a
 * `0` is the signal to delete, and a large number is the warning that deleting will be felt.
 */
import type { LabelOut, TeamOut } from '@docket/types';
import { LabelChip } from '@docket/ui/components';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { Ellipsis } from '@docket/ui/icons';
import type { JSX } from 'react';

/** Props for {@link LabelSettingsRow}. */
export interface LabelSettingsRowProps {
  /** The label to render. */
  label: LabelOut;
  /** The org's teams, for the "Limit to" submenu. */
  teams: readonly TeamOut[];
  /** Whether the viewer may restructure labels. */
  canManage: boolean;
  /** Hide scope controls entirely (a personal workspace has no meaningful team axis). */
  hideScope?: boolean;
  /** Open the editor on this label. */
  onEdit: () => void;
  /** Limit this label to a team, or null to promote it back to workspace-wide. */
  onScope: (teamId: string | null) => void;
  /** Delete this label. */
  onDelete: () => void;
}

/** Render the usage count, or the phrase that makes a zero actionable. */
function usageText(count: number | undefined): string {
  if (count === undefined) return '';
  if (count === 0) return 'Not used';
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/**
 * One label row.
 *
 * @param props - The {@link LabelSettingsRowProps}.
 * @returns The rendered row.
 */
export function LabelSettingsRow({
  label,
  teams,
  canManage,
  hideScope = false,
  onEdit,
  onScope,
  onDelete,
}: LabelSettingsRowProps): JSX.Element {
  const team = label.teamId ? teams.find((t) => t.id === label.teamId) : undefined;

  return (
    // Flush inside its list's container rather than an island of its own. Each row used to paint
    // its own fill and radius, so a set of five labels read as five cards with gaps between them
    // instead of one list you can scan down.
    <li className="hover:bg-surface-container flex min-h-12 items-center gap-3 px-4 py-3 transition-colors">
      <LabelChip name={label.name} color={label.color} className="max-w-56" />

      <span className="text-on-surface-variant text-body-small ml-auto shrink-0 tabular-nums">
        {usageText(label.usageCount)}
      </span>

      {team && !hideScope ? (
        <span className="text-on-surface-variant text-label-small shrink-0">{team.name} only</span>
      ) : null}

      {label.external ? (
        // Provenance matters here specifically: an import creates labels nobody chose, and the
        // person cleaning up needs to know which ones those are.
        <span className="text-on-surface-variant text-label-small shrink-0">Imported</span>
      ) : null}

      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Actions for ${label.name}`}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Rename or recolor</DropdownMenuItem>
            {!hideScope && teams.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Limit to a team</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {label.teamId ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        onScope(null);
                      }}
                    >
                      Whole workspace
                    </DropdownMenuItem>
                  ) : null}
                  {teams
                    .filter((t) => t.id !== label.teamId)
                    .map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={() => {
                          onScope(t.id);
                        }}
                      >
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-error focus:text-error" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
