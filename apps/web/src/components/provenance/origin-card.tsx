'use client';

/**
 * The origin card: who created an entity, who last changed it, and how each change arrived.
 *
 * @remarks
 * Provenance stays out of the way until someone asks. The card opens from the Created row on a
 * detail page (hover or keyboard focus), or from the Show origin action, and only then reads
 * `GET /provenance/:kind/:id`. Each side is a label and a value: the performer's avatar, the
 * performer and channel from {@link formatProvenanceEvent}, and a relative time that keeps the
 * exact time in its tooltip. A side with nothing to say is left out, and a card with neither side
 * does not open, so the row reads as the plain date it always was. See
 * `docs/engineering/specs/provenance.md` §4.
 */
import type { ProvenanceEventOut, ProvenanceOut } from '@docket/work/provenance-contract';
import { relativeTime } from '@docket/ui';
import { ActorAvatar, RelativeTime } from '@docket/ui/components';
import { HoverCard, HoverCardContent, HoverCardTrigger, Skeleton } from '@docket/ui/primitives';
import {
  type JSX,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { UseQueryResult } from '@tanstack/react-query';

import { QueryLoadFailure } from '@/components/feedback';
import { useEntityMetadataPlacement } from '@/components/views/entity-detail-context';
import { type ProvenanceSubject, provenanceDef, useViewerActorId } from '@/lib/provenance/defs';
import { type ProvenanceDisplay, formatProvenanceEvent } from '@/lib/provenance/format';
import {
  clearOriginRequest,
  originRequestMatches,
  readOriginRequest,
  subscribeOriginRequest,
} from '@/lib/provenance/origin-request';
import { useApiQuery } from '@/lib/query';

/** One side of the card, ready to render. */
export interface OriginRowModel {
  readonly label: string;
  readonly at: string;
  readonly display: ProvenanceDisplay;
}

/** One side of the provenance answer and the label it is shown under. */
interface OriginSide {
  readonly label: string;
  readonly event: ProvenanceEventOut | null;
}

/**
 * The rows the card shows: Created, then Last changed, each only when it can be named.
 *
 * @param provenance - The provenance answer.
 * @param currentActorId - The viewer's actor, so their own changes read "You".
 * @returns the rows, possibly empty.
 */
export function originRows(
  provenance: ProvenanceOut,
  currentActorId: string | null,
): readonly OriginRowModel[] {
  const sides: readonly OriginSide[] = [
    { label: 'Created', event: provenance.created },
    { label: 'Last changed', event: provenance.lastChanged },
  ];
  return sides.flatMap(({ label, event }) => {
    const display = event === null ? null : formatProvenanceEvent(event, currentActorId);
    return event === null || display === null ? [] : [{ label, at: event.at, display }];
  });
}

/** Props for {@link OriginRow}. */
interface OriginRowProps {
  readonly row: OriginRowModel;
}

/** One labelled side of the card. */
function OriginRow({ row }: OriginRowProps): JSX.Element {
  const { display } = row;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-label-medium text-on-surface-variant">{row.label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <ActorAvatar
          kind={display.avatarKind}
          name={display.avatarName ?? display.performer}
          size={20}
          className="shrink-0"
        />
        <span className="text-body-medium text-on-surface truncate">{display.performer}</span>
        {display.detail === null ? null : (
          <span className="text-body-medium text-on-surface-variant shrink-0 truncate">
            · {display.detail}
          </span>
        )}
        <RelativeTime
          iso={row.at}
          className="text-label-medium text-on-surface-variant ml-auto shrink-0 whitespace-nowrap"
        >
          {relativeTime(row.at)}
        </RelativeTime>
      </dd>
    </div>
  );
}

/** Props for {@link OriginCard}. */
export interface OriginCardProps {
  readonly rows: readonly OriginRowModel[];
}

/**
 * The card's rows.
 *
 * @param props - The rows to show.
 * @returns the labelled list.
 */
export function OriginCard({ rows }: OriginCardProps): JSX.Element {
  return (
    <dl aria-label="Origin" className="flex flex-col gap-3">
      {rows.map((row) => (
        <OriginRow key={row.label} row={row} />
      ))}
    </dl>
  );
}

/** Two placeholder rows while the answer loads. */
function OriginCardSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

/** Props for {@link OriginCardContent}. */
interface OriginCardContentProps {
  readonly subject: ProvenanceSubject;
}

/** The floating card, reading the answer the moment it opens. */
function OriginCardContent({ subject }: OriginCardContentProps): JSX.Element | null {
  const query = useApiQuery(provenanceDef(subject, true));
  const currentActorId = useViewerActorId(subject.organizationId, true);
  const rows = query.data ? originRows(query.data, currentActorId) : [];
  if (query.isSuccess && rows.length === 0) return null;
  return (
    <HoverCardContent side="bottom" align="start" width="lg">
      <OriginCardBody rows={rows} query={query} />
    </HoverCardContent>
  );
}

/** Props for {@link OriginCardBody}. */
interface OriginCardBodyProps {
  readonly rows: readonly OriginRowModel[];
  readonly query: UseQueryResult<ProvenanceOut>;
}

/** Loading, failed, or answered. */
function OriginCardBody({ rows, query }: OriginCardBodyProps): JSX.Element {
  if (query.isPending) return <OriginCardSkeleton />;
  if (query.isError) return <QueryLoadFailure size="panel" title="Origin" query={query} />;
  return <OriginCard rows={rows} />;
}

/**
 * Open the card when the Show origin action asks for this entity.
 *
 * @remarks
 * A copy of the row that is hidden in a metadata row's inline lane opens the overflow instead, so
 * the visible copy there mounts and answers.
 */
function useAnswerOriginRequest(
  subject: ProvenanceSubject,
  triggerRef: RefObject<HTMLElement | null>,
  open: () => void,
): void {
  const placement = useEntityMetadataPlacement();
  const request = useSyncExternalStore(subscribeOriginRequest, readOriginRequest, () => null);
  const { kind, id } = subject;
  useEffect(() => {
    if (!originRequestMatches(request, { kind, id })) return;
    if (placement.hidden) {
      placement.reveal?.();
      return;
    }
    clearOriginRequest();
    triggerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    open();
  }, [id, kind, open, placement, request, triggerRef]);
}

/** Props for {@link OriginHoverCard}. */
export interface OriginHoverCardProps {
  /** The entity whose origin the card answers for. */
  readonly subject: ProvenanceSubject;
  /** The trigger: one focusable element, typically the Created date. */
  readonly children: ReactElement;
}

/**
 * Wrap a Created row's value in the origin card.
 *
 * @remarks
 * Hover or keyboard focus opens it after a short delay; a click or a tap opens it at once, since a
 * touch screen has no hover. The Show origin action opens it through the origin request store.
 *
 * @param props - The {@link OriginHoverCardProps}.
 * @returns the trigger with its card.
 */
export function OriginHoverCard({ subject, children }: OriginHoverCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  // Radix types the trigger as an anchor; with `asChild` it is whichever element the child is.
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const openCard = useCallback(() => {
    setOpen(true);
  }, []);
  useAnswerOriginRequest(subject, triggerRef, openCard);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={180} closeDelay={120}>
      <HoverCardTrigger
        asChild
        ref={triggerRef}
        onClick={openCard}
        onPointerUp={(event) => {
          if (event.pointerType === 'touch') openCard();
        }}
      >
        {children}
      </HoverCardTrigger>
      {open ? <OriginCardContent subject={subject} /> : null}
    </HoverCard>
  );
}
