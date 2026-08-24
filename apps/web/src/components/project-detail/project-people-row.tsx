'use client';

/**
 * Project ownership and assigned-people context for the detail masthead.
 *
 * @remarks
 * Ownership is an accountable property, not an afterthought below the document. The owner picker
 * therefore gets a labelled row above operational properties. Task assignees and delegates are
 * supporting context only: they collapse to three overlapping avatars plus a remainder count,
 * while the accessible name preserves the full deduplicated roster.
 */
import { ActorAvatar, ActorPicker, type ActorKind, type PickerOption } from '@docket/ui/components';
import type { JSX } from 'react';

import { ENTITY_METADATA_CHIP_CLASS } from '@/components/views/entity-detail-layout';

/** One actor assigned to work inside the project. */
export interface ProjectAssignedPerson {
  /** Stable actor id used for deduplication and owner exclusion. */
  readonly actorId: string;
  /** Human-readable actor name. */
  readonly name: string;
  /** Avatar shape for a person, agent, or team. */
  readonly kind: ActorKind;
}

/** Props for {@link ProjectPeopleRow}. */
export interface ProjectPeopleRowProps {
  /** The accountable Project owner, or `null` when unset. */
  readonly ownerId: string | null;
  /** Workspace actors eligible to own the Project. */
  readonly ownerOptions: readonly PickerOption[];
  /** Actors assigned to tasks in the Project, including possible duplicates and the owner. */
  readonly assignedPeople: readonly ProjectAssignedPerson[];
  /** Whether the viewer may change ownership. */
  readonly canEdit: boolean;
  /** Whether the owner roster is resolving after the picker opened. */
  readonly ownerLoading?: boolean;
  /** Observe owner-picker visibility so its roster can stay off the critical route path. */
  readonly onOwnerPickerOpenChange?: (open: boolean) => void;
  /** Persist an owner selection or clear. */
  readonly onOwnerChange: (ownerId: string | null) => void;
}

/**
 * Render the Project owner and a compact indicator for everyone else assigned.
 *
 * @param props - Controlled ownership state and assigned actors.
 * @returns The non-wrapping masthead people row.
 */
export function ProjectPeopleRow({
  ownerId,
  ownerOptions,
  assignedPeople,
  canEdit,
  ownerLoading = false,
  onOwnerPickerOpenChange,
  onOwnerChange,
}: ProjectPeopleRowProps): JSX.Element {
  const uniqueOthers = [
    ...new Map(
      assignedPeople
        .filter((person) => person.actorId !== ownerId)
        .map((person) => [person.actorId, person]),
    ).values(),
  ];
  const visible = uniqueOthers.slice(0, 3);
  const remaining = uniqueOthers.length - visible.length;
  const peopleLabel = `${String(uniqueOthers.length)} other ${uniqueOthers.length === 1 ? 'person' : 'people'} assigned: ${uniqueOthers.map((person) => person.name).join(', ')}`;

  return (
    <div
      aria-label="Project ownership"
      className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden"
    >
      <ActorPicker
        options={ownerOptions}
        value={ownerId}
        onChange={onOwnerChange}
        placeholder="Set owner"
        clearLabel="No owner"
        searchPlaceholder="Search people…"
        ariaLabel="Project owner"
        readOnly={!canEdit}
        loading={ownerLoading}
        {...(onOwnerPickerOpenChange ? { onOpenChange: onOwnerPickerOpenChange } : {})}
        triggerVariant="ghost"
        triggerClassName={`${ENTITY_METADATA_CHIP_CLASS} max-w-56`}
      />
      {uniqueOthers.length > 0 ? (
        <div
          aria-label={peopleLabel}
          title={uniqueOthers.map((person) => person.name).join(', ')}
          className="ml-1 flex shrink-0 -space-x-2"
        >
          {visible.map((person) => (
            <ActorAvatar
              key={person.actorId}
              kind={person.kind}
              name={person.name}
              size={24}
              className="ring-surface ring-2"
            />
          ))}
          {remaining > 0 ? (
            <span className="bg-surface-container-high text-on-surface-variant text-label-small ring-surface relative inline-flex size-6 items-center justify-center rounded-full ring-2">
              +{remaining}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
