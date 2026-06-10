'use client';

/**
 * `views` — the inline composer that saves the current working query as a new saved view.
 *
 * @remarks
 * "Create / save a new view from the current filter" (mvp-plan §8.3d). The design system has no
 * Dialog primitive (mirroring the rest of the app, which composes inline {@link Card} panels
 * rather than modals), so this is a small bordered panel that drops in below the filter builder:
 * a name {@link Input} and a sharing-scope picker (a styled {@link DropdownMenu} — never a bare
 * `<select>`), with a one-line summary of the query being captured so the author sees exactly
 * what will be stored. Saving emits the create payload to the parent (the page owns the RPC
 * call and optimistic insert); Cancel collapses the panel.
 *
 * Scope choices map to {@link ViewScope}: Personal (only you), Team (your team), Organization
 * (everyone). The team scope is offered only when the org has a team id to attach; without one
 * the option is omitted so a team-scoped view is never saved with a dangling team.
 */
import type { SavedViewCreate, ViewFilter, ViewGrouping, ViewScope, ViewSort } from '@docket/types';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
} from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

/** The scope options offered in the composer, in widening-reach order. */
const SCOPE_OPTIONS: readonly { value: ViewScope; label: string; hint: string }[] = [
  { value: 'personal', label: 'Personal', hint: 'Only you' },
  { value: 'team', label: 'Team', hint: 'Your team' },
  { value: 'organization', label: 'Organization', hint: 'Everyone in the org' },
];

/** Props for {@link SaveViewComposer}. */
export interface SaveViewComposerProps {
  /** The working query's filters being captured. */
  filters: readonly ViewFilter[];
  /** The working query's grouping being captured. */
  grouping: ViewGrouping | null;
  /** The working query's sort being captured. */
  sort: readonly ViewSort[];
  /** A one-line, human summary of the query (rendered as the panel's caption). */
  summary: string;
  /** Whether the org has a team id to attach a team-scoped view to. */
  canScopeToTeam: boolean;
  /** Whether a save is in flight (disables the form). */
  saving: boolean;
  /** A save error to surface, or `null`. */
  error: string | null;
  /** Save the view; the parent owns the RPC call. */
  onSave: (payload: SavedViewCreate) => void;
  /** Collapse the composer without saving. */
  onCancel: () => void;
}

/**
 * The inline "save this view" panel.
 *
 * @param props - The {@link SaveViewComposerProps}.
 * @returns the rendered composer panel.
 */
export function SaveViewComposer({
  filters,
  grouping,
  sort,
  summary,
  canScopeToTeam,
  saving,
  error,
  onSave,
  onCancel,
}: SaveViewComposerProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ViewScope>('personal');

  const scopeOptions = SCOPE_OPTIONS.filter((option) => option.value !== 'team' || canScopeToTeam);
  const activeScope = scopeOptions.find((option) => option.value === scope) ?? scopeOptions[0];

  /** Build the create payload from the current form state and emit it. */
  function submit(): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSave({
      name: trimmed,
      scope,
      ...(filters.length > 0 ? { filters: [...filters] } : {}),
      ...(grouping ? { grouping } : {}),
      ...(sort.length > 0 ? { sort: [...sort] } : {}),
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-body font-medium">
              View name
            </label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              placeholder="e.g. Urgent &amp; unassigned"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium">Who can see this view</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="w-fit gap-2">
                  <span>{activeScope?.label ?? 'Personal'}</span>
                  <span className="text-on-surface-variant text-xs">{activeScope?.hint}</span>
                  <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[14rem]">
                <DropdownMenuRadioGroup
                  value={scope}
                  onValueChange={(next) => {
                    setScope(next as ViewScope);
                  }}
                >
                  {scopeOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <span className="flex w-full items-center justify-between gap-6">
                        <span>{option.label}</span>
                        <span className="text-on-surface-variant text-xs">{option.hint}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="text-on-surface-variant text-xs">
            Captures: <span className="text-on-surface">{summary}</span>
          </p>

          {error ? (
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving || name.trim().length === 0}>
              {saving ? 'Saving…' : 'Save view'}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
