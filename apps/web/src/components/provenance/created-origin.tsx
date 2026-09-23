'use client';

/**
 * The Created value on a detail page, which opens the origin card.
 *
 * @remarks
 * Two presentations of the same fact. {@link CreatedOriginDate} is the plain date in a property
 * footer; {@link CreatedOriginChip} is the "Created" chip a metadata row keeps in its overflow.
 * Either one reads just the date until someone hovers, focuses, or taps it. The entity comes from
 * the `subject` prop or, inside an `EntityDetailLayout`, from the page's own object.
 */
import {
  PROVENANCE_ENTITY_KINDS,
  type ProvenanceEntityKind,
} from '@docket/work/provenance-contract';
import { Schedule } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactElement } from 'react';

import { useEntityDetailObject } from '@/components/views/entity-detail-context';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityMetadataItem,
} from '@/components/views/entity-detail-layout';
import type { ObjectRef } from '@/lib/actions/object';
import { formatCalendarDate } from '@/lib/format-date';
import type { ProvenanceSubject } from '@/lib/provenance/defs';

import { OriginHoverCard } from './origin-card';

/** Props for the Created value. */
export interface CreatedOriginProps {
  /** When the entity was created (ISO-8601). */
  readonly createdAt: string;
  /** The entity the date belongs to; defaults to the detail page's object. */
  readonly subject?: ProvenanceSubject | undefined;
}

const PROVENANCE_KINDS: ReadonlySet<string> = new Set(PROVENANCE_ENTITY_KINDS);

/**
 * The provenance subject an object names, when provenance covers its kind.
 *
 * @param object - A task, project, program, or initiative reference.
 * @returns the subject, or null for other kinds and personal objects.
 */
export function provenanceSubjectOf(object: ObjectRef | null): ProvenanceSubject | null {
  if (!object || !PROVENANCE_KINDS.has(object.kind)) return null;
  const { organizationId } = object;
  if (organizationId === null) return null;
  return { kind: object.kind as ProvenanceEntityKind, id: object.id, organizationId };
}

/** The subject from the prop, else from the enclosing detail page. */
function useCreatedSubject(subject: ProvenanceSubject | undefined): ProvenanceSubject | null {
  const pageObject = useEntityDetailObject();
  return subject ?? provenanceSubjectOf(pageObject);
}

/** Props for {@link WithOriginCard}. */
interface WithOriginCardProps {
  readonly subject: ProvenanceSubject | null;
  readonly children: ReactElement;
}

/** The trigger inside its origin card, or on its own when there is no entity to ask about. */
function WithOriginCard({ subject, children }: WithOriginCardProps): JSX.Element {
  if (subject === null) return children;
  return <OriginHoverCard subject={subject}>{children}</OriginHoverCard>;
}

/**
 * The created date as quiet text that opens the origin card.
 *
 * @param props - The {@link CreatedOriginProps}.
 * @returns the date trigger.
 */
export function CreatedOriginDate({ subject, createdAt }: CreatedOriginProps): JSX.Element {
  const resolved = useCreatedSubject(subject);
  return (
    <WithOriginCard subject={resolved}>
      <button
        type="button"
        data-created-origin=""
        className="hover:text-on-surface focus-visible:ring-ring rounded-md text-left focus-visible:ring-1 focus-visible:outline-none"
      >
        {formatCalendarDate(createdAt) ?? '—'}
      </button>
    </WithOriginCard>
  );
}

/**
 * The Created chip for a metadata row, kept in the row's overflow.
 *
 * @param props - The {@link CreatedOriginProps}.
 * @returns the chip, as a metadata item.
 */
export function CreatedOriginChip({ subject, createdAt }: CreatedOriginProps): JSX.Element {
  const resolved = useCreatedSubject(subject);
  return (
    <EntityMetadataItem priority={7} overflowOnly>
      <WithOriginCard subject={resolved}>
        <Button
          type="button"
          variant="ghost"
          data-created-origin=""
          className={cn(ENTITY_METADATA_CHIP_CLASS, 'text-on-surface text-body-medium')}
        >
          <Schedule aria-hidden className="size-4" />
          <span className="truncate">Created {formatCalendarDate(createdAt) ?? '—'}</span>
        </Button>
      </WithOriginCard>
    </EntityMetadataItem>
  );
}
