'use client';

import type { WorkflowState } from '@docket/types';
import { StatusIcon, type WorkflowStateType } from '@docket/ui/components';
import { Check, ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link StatusPicker}. */
interface StatusPickerProps {
  /** The task's current `state` key (matches a `WorkflowState.key`, or a custom key). */
  current: string;
  /**
   * The team's ordered workflow states. When `null`, the team detail is still loading
   * and the trigger renders a read-only chip for the current state.
   */
  states: readonly WorkflowState[] | null;
  /** Canonical type for the current state (drives the glyph color when states are absent). */
  currentType: WorkflowStateType;
  /** Called with the chosen state key when a different state is selected. */
  onSelect: (stateKey: string) => void;
  /** Whether a transition is in flight (disables the trigger and shows it busy). */
  pending: boolean;
}

/**
 * The editable workflow-state control on the task header.
 *
 * @remarks
 * Renders the current state as a {@link StatusIcon} + label button that opens a menu of
 * the team's `workflow_states` (the only valid transition targets — the API validates
 * the key against the team's workflow). Each menu row shows its own state glyph and a
 * check on the active state. Selecting the current state is a no-op. While the team
 * workflow is still loading (`states === null`) the trigger is disabled and shows the
 * current state read-only. All affordances are keyboard-navigable via the Radix menu.
 */
export function StatusPicker({
  current,
  states,
  currentType,
  onSelect,
  pending,
}: StatusPickerProps): JSX.Element {
  const activeState = states?.find((s) => s.key === current);
  const label = activeState?.name ?? humanizeKey(current);
  const type = activeState?.type ?? currentType;

  if (!states) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <StatusIcon type={type} />
        {label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} className="gap-2">
          <StatusIcon type={type} />
          {label}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {states.map((state) => (
          <DropdownMenuItem
            key={state.key}
            onSelect={() => {
              if (state.key !== current) onSelect(state.key);
            }}
            className="gap-2"
          >
            <StatusIcon type={state.type} />
            <span className="flex-1">{state.name}</span>
            {state.key === current ? <Check className="text-muted-foreground size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Turn a snake/kebab state key into a Title Case label as a last-resort fallback. */
function humanizeKey(key: string): string {
  return key
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
