'use client';

/**
 * `settings` — the per-member plain-language role picker.
 *
 * @remarks
 * A styled {@link DropdownMenu} (never a bare `<select>`) whose radio items are the four
 * system roles in plain language (Owner / Admin / Member / Guest), each with a one-line
 * "what they can do" summary so access decisions need no capability jargon. The trigger is a
 * quiet outline button showing the current role with a chevron; choosing a different role
 * calls `onChange` with that role's id. While a change is in flight the control is disabled
 * and the trigger reads "Saving…". When the caller cannot manage members (or this is the org's
 * last owner) the control renders read-only as a quiet label.
 */
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
import { ChevronDown } from '@docket/ui/icons';
import type { JSX } from 'react';

import { asRoleKey, ROLE_PLAIN_LANGUAGE } from './roles';

/** One assignable role option resolved from the org's seeded roles. */
export interface RoleOption {
  /** The role's id (sent to the API). */
  readonly id: string;
  /** The role's immutable system key (e.g. `owner`). */
  readonly key: string;
}

/** Props for {@link RoleControl}. */
export interface RoleControlProps {
  /** The roles assignable in this org, ordered most-privileged first. */
  options: readonly RoleOption[];
  /** The currently assigned role id, or `null` when unknown. */
  value: string | null;
  /** Called with the chosen role id when the selection changes. */
  onChange: (roleId: string) => void;
  /** Whether a role change is currently in flight (disables the control). */
  saving?: boolean;
  /** When false, the control is read-only (caller lacks manage, or this is the last owner). */
  canEdit: boolean;
  /** Accessible label for the trigger (e.g. "Role for Ada Lovelace"). */
  ariaLabel: string;
}

/** Resolve a role id to its plain-language label, falling back to a generic "Member". */
function labelFor(options: readonly RoleOption[], roleId: string | null): string {
  const option = options.find((o) => o.id === roleId);
  const key = option ? asRoleKey(option.key) : null;
  return key ? ROLE_PLAIN_LANGUAGE[key].label : 'Member';
}

/**
 * A plain-language, keyboard-accessible role picker for a single member.
 *
 * @param props - The {@link RoleControlProps}.
 * @returns the rendered role control.
 */
export function RoleControl({
  options,
  value,
  onChange,
  saving = false,
  canEdit,
  ariaLabel,
}: RoleControlProps): JSX.Element {
  const currentLabel = labelFor(options, value);

  if (!canEdit) {
    return (
      <span
        className="text-on-surface-variant inline-flex h-8 items-center px-2 text-sm"
        aria-label={ariaLabel}
      >
        {currentLabel}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          aria-label={ariaLabel}
          className="min-w-28 justify-between"
        >
          <span>{saving ? 'Saving…' : currentLabel}</span>
          <ChevronDown aria-hidden="true" className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Choose a role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(next) => {
            if (next !== value) onChange(next);
          }}
        >
          {options.map((option) => {
            const key = asRoleKey(option.key);
            const copy = key ? ROLE_PLAIN_LANGUAGE[key] : null;
            return (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                className="flex-col items-start gap-0.5 py-2"
              >
                <span className="text-on-surface font-medium">{copy?.label ?? option.key}</span>
                {copy ? (
                  <span className="text-on-surface-variant text-xs leading-snug">
                    {copy.summary}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
