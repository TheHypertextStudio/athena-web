'use client';

/**
 * `useComposerKindPersistence` — the composer-side adapter over `useComposerDraftPersistence`.
 *
 * @remarks
 * Every create composer resolves the same three things before it can persist a draft: whether it
 * is open with a ready destination, which workspace that destination is, and which draft the host
 * asked it to reopen. This hook turns those composer facts into the persistence hook's inputs so
 * each composer's own hook (`useTaskDraftPersistence` and friends) only has to supply its codec
 * and its roster-bound `hydrate`.
 *
 * It also publishes the row the composer is writing to. The global create provider keeps that id
 * so a navigation that closes the composer can leave a pointer to the draft behind.
 */
import type { ComposerDraftKind, ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { useEffect } from 'react';

import {
  type ComposerDraftPersistence,
  useComposerDraftPersistence,
} from './use-composer-draft-persistence';

/** What a composer supplies, beyond its codec. */
export interface ComposerKindPersistenceOptions<T extends object> {
  readonly kind: ComposerDraftKind;
  /** The composer's destination workspace; empty while the global host has none. */
  readonly orgId: string;
  readonly open: boolean;
  /** Whether the destination workspace and its creation data have resolved. */
  readonly destinationReady: boolean;
  readonly draft: T;
  /** The shell's rule: typed text that has not become a record. */
  readonly isDirty: boolean;
  /** A module-level function. */
  readonly serialize: (draft: T) => ComposerDraftPayload;
  /** Stable for as long as the rosters it closes over are. */
  readonly hydrate: (payload: ComposerDraftPayload) => Partial<T>;
  readonly updateDraft: (recipe: (current: T) => Partial<T>) => void;
  /** The draft the host asked the composer to reopen, if any. */
  readonly resumeDraftId: string | null | undefined;
  /** Receives the id of the row being written, and null once there is none. */
  readonly onDraftIdChange?: ((draftId: string | null) => void) | undefined;
}

/**
 * Persist a composer's draft, resolving the destination and publishing the current row.
 *
 * @returns what `useComposerDraftPersistence` returns.
 */
export function useComposerKindPersistence<T extends object>({
  kind,
  orgId,
  open,
  destinationReady,
  draft,
  isDirty,
  serialize,
  hydrate,
  updateDraft,
  resumeDraftId,
  onDraftIdChange,
}: ComposerKindPersistenceOptions<T>): ComposerDraftPersistence {
  const persistence = useComposerDraftPersistence<T>({
    kind,
    orgId: destinationReady && orgId.length > 0 ? orgId : null,
    enabled: open && destinationReady,
    draft,
    isDirty,
    serialize,
    hydrate,
    updateDraft,
    resumeDraftId: resumeDraftId ?? null,
  });

  const currentId = persistence.controls.currentId;
  useEffect(() => {
    onDraftIdChange?.(currentId);
  }, [currentId, onDraftIdChange]);

  return persistence;
}
