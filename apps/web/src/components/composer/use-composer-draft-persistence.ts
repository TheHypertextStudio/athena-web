'use client';

/**
 * `useComposerDraftPersistence` — keep a create composer's draft on the server as it is typed.
 *
 * @remarks
 * A composer's fields live in React state for the life of one open. This hook watches that state
 * and, once it holds typed text, writes it to `/v1/me/drafts` after a short quiet period: the
 * first write creates the row, later writes patch it against the revision last seen, and a stale
 * refusal is rebased once. The row is deleted when the composer creates its record ("commit"),
 * when the person answers the close prompt with Discard, or when they delete it from the Drafts
 * chip; it is kept when they answer Save draft or navigate away. Loading a draft from the chip
 * or the Drafts page pours its payload back into the composer through the host's `hydrate`.
 *
 * Saving never blocks editing or submitting. A failed save is shown as "Not saved" and retried by
 * the next edit; nothing is queued client-side.
 */
import type {
  ComposerDraftKind,
  ComposerDraftOut,
  ComposerDraftPayload,
} from '@docket/work/composer-draft-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type DraftCacheWriters,
  createComposerDraft,
  deleteComposerDraft,
  fetchComposerDraft,
  patchComposerDraft,
  useComposerDrafts,
  useDraftCacheWriters,
} from '@/lib/drafts/defs';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

/** Where a save stands, for the composer's status text. */
export type ComposerDraftSaveState = 'idle' | 'saving' | 'saved' | 'error';

/** One draft as the chip and the close prompt list it. */
export interface ComposerDraftSummary {
  readonly id: string;
  /** The server-derived title, or null for a draft with only a body. */
  readonly title: string | null;
  readonly updatedAt: string;
}

/** What `ComposerShell` needs to show the Drafts chip and answer the close prompt. */
export interface ComposerDraftControls {
  /** This kind's drafts in this workspace, newest first. */
  readonly items: readonly ComposerDraftSummary[];
  /** The draft the open composer is writing to, once one exists. */
  readonly currentId: string | null;
  readonly saving: ComposerDraftSaveState;
  /** Replace the composer's content with a draft's. */
  readonly onLoad: (draftId: string) => void;
  /** Delete a draft from the chip's list. */
  readonly onDelete: (draftId: string) => void;
  /** The close prompt's Save draft answer: keep the row and stop writing. */
  readonly onKeep: () => Promise<void>;
  /** The close prompt's Discard answer: delete the row and stop writing. */
  readonly onDiscard: () => Promise<void>;
}

/** What the hook needs from the composer it persists. */
export interface ComposerDraftPersistenceOptions<T extends object> {
  readonly kind: ComposerDraftKind;
  /** The destination workspace, or null until the host has resolved it. */
  readonly orgId: string | null;
  /** Whether the composer is open with a resolved destination. */
  readonly enabled: boolean;
  readonly draft: T;
  /** The shell's own rule: typed text, never bare property picks. */
  readonly isDirty: boolean;
  /** Turn the composer's draft into the wire payload; a module-level function. */
  readonly serialize: (draft: T) => ComposerDraftPayload;
  /** Turn a wire payload into a patch for the composer's draft; a module-level function. */
  readonly hydrate: (payload: ComposerDraftPayload) => Partial<T>;
  readonly updateDraft: (recipe: (current: T) => Partial<T>) => void;
  /** A draft to load once on mount, from the Drafts page, an interrupted open, or the setting. */
  readonly resumeDraftId: string | null;
}

/** What the hook hands back to the composer. */
export interface ComposerDraftPersistence {
  readonly controls: ComposerDraftControls;
  /** Advances whenever a draft is poured in, so the rich editor accepts the new body. */
  readonly loadGeneration: number;
  /**
   * The draft became a record: delete its row and start fresh, so a "Create more" composer can
   * begin a new draft without carrying the old id.
   */
  readonly commit: () => Promise<void>;
}

/** The row the open composer is writing to. */
interface PersistedRow {
  readonly id: string;
  readonly revision: number;
}

/** The baseline before a row exists; never equal to a payload, so the first dirty value saves. */
interface NoRow {
  readonly noRow: true;
}
const NO_ROW: NoRow = { noRow: true };

/** What the autosave compares: a payload, or the marker that no row exists yet. */
type AutosaveValue = ComposerDraftPayload | NoRow;

/** Quiet period before an edit is written, the same as every other autosaving field. */
const SAVE_DELAY_MS = 600;

/** Lift a draft row into what the chip lists. */
function summarize(draft: ComposerDraftOut): ComposerDraftSummary {
  return { id: draft.id, title: draft.title, updatedAt: draft.updatedAt };
}

/** The server row the open composer writes to, and the one serialized write queue behind it. */
interface DraftRow {
  readonly persisted: AutosaveValue;
  readonly currentId: string | null;
  readonly saving: ComposerDraftSaveState;
  /** Queue a write behind any in flight; a no-op once disposed or without a destination. */
  readonly save: (next: AutosaveValue) => void;
  /** Make a fetched draft the row being written, without writing it. */
  readonly adopt: (out: ComposerDraftOut) => void;
  /** Forget the row and stop; returns the row that was forgotten, once writes have settled. */
  readonly release: (options: { readonly rearm: boolean }) => Promise<PersistedRow | null>;
  /** Forget a row deleted from outside, if it is the current one. */
  readonly forget: (draftId: string) => void;
  /** Whether a save is queued or in flight is not observable; this is the row itself. */
  readonly current: () => PersistedRow | null;
}

/** Own the row and the write queue. */
function useDraftRow(kind: ComposerDraftKind, orgId: string | null, cache: DraftCacheWriters) {
  const rowRef = useRef<PersistedRow | null>(null);
  const disposedRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const [persisted, setPersisted] = useState<AutosaveValue>(NO_ROW);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saving, setSaving] = useState<ComposerDraftSaveState>('idle');

  const reset = useCallback((): void => {
    rowRef.current = null;
    setPersisted(NO_ROW);
    setCurrentId(null);
    setSaving('idle');
  }, []);

  const save = useCallback(
    (next: AutosaveValue): void => {
      // Disposal is decided when a write is queued, never when it runs: `onKeep` flushes the
      // pending text and disposes in the same tick, and the write it just queued must still land.
      if (disposedRef.current || orgId === null || 'noRow' in next) return;
      chainRef.current = chainRef.current.then(async () => {
        setSaving('saving');
        try {
          const row = rowRef.current;
          const out =
            row === null
              ? await createComposerDraft({ organizationId: orgId, kind, payload: next })
              : await patchComposerDraft(row.id, row.revision, next);
          rowRef.current = { id: out.id, revision: out.revision };
          cache.upsert(out);
          setPersisted(out.payload);
          setCurrentId(out.id);
          setSaving('saved');
        } catch {
          setSaving('error');
        }
      });
    },
    [cache, kind, orgId],
  );

  const adopt = useCallback((out: ComposerDraftOut): void => {
    rowRef.current = { id: out.id, revision: out.revision };
    setPersisted(out.payload);
    setCurrentId(out.id);
    setSaving('saved');
  }, []);

  const release = useCallback(
    async ({ rearm }: { readonly rearm: boolean }): Promise<PersistedRow | null> => {
      disposedRef.current = true;
      await chainRef.current;
      const row = rowRef.current;
      reset();
      if (rearm) disposedRef.current = false;
      return row;
    },
    [reset],
  );

  const forget = useCallback(
    (draftId: string): void => {
      if (rowRef.current?.id === draftId) reset();
    },
    [reset],
  );

  const current = useCallback(() => rowRef.current, []);

  return useMemo<DraftRow>(
    () => ({ persisted, currentId, saving, save, adopt, release, forget, current }),
    [adopt, current, currentId, forget, persisted, release, save, saving],
  );
}

/** Whether the draft has a resolved destination. */
function readyFor(enabled: boolean, orgId: string | null, isDirty: boolean): boolean {
  return enabled && orgId !== null && isDirty;
}

/**
 * Keep a composer's draft on the server as it is typed.
 *
 * @param options - See {@link ComposerDraftPersistenceOptions}.
 * @returns the controls for the shell, the load generation, and `commit`.
 */
export function useComposerDraftPersistence<T extends object>({
  kind,
  orgId,
  enabled,
  draft,
  isDirty,
  serialize,
  hydrate,
  updateDraft,
  resumeDraftId,
}: ComposerDraftPersistenceOptions<T>): ComposerDraftPersistence {
  const drafts = useComposerDrafts();
  const cache = useDraftCacheWriters();
  const row = useDraftRow(kind, orgId, cache);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const payload = useMemo<AutosaveValue>(() => serialize(draft), [draft, serialize]);

  const autosave = useDebouncedAutosave<AutosaveValue>({
    value: payload,
    baseline: row.persisted,
    ready: readyFor(enabled, orgId, isDirty),
    save: row.save,
    delayMs: SAVE_DELAY_MS,
  });

  const load = useCallback(
    (out: ComposerDraftOut): void => {
      updateDraft(() => hydrate(out.payload));
      row.adopt(out);
      setLoadGeneration((generation) => generation + 1);
    },
    [hydrate, row, updateDraft],
  );

  const findDraft = useCallback(
    async (draftId: string): Promise<ComposerDraftOut> =>
      drafts.data?.items.find((item) => item.id === draftId) ?? fetchComposerDraft(draftId),
    [drafts.data],
  );

  useDraftLifecycle({
    enabled,
    resumeDraftId,
    orgId,
    isDirty,
    row,
    cache,
    findDraft,
    load,
    autosave,
  });

  const answers = useDraftAnswers({ row, cache, autosave, findDraft, load });

  const items = useMemo(
    () =>
      (drafts.data?.items ?? [])
        .filter((item) => item.kind === kind && item.organizationId === orgId)
        .map(summarize),
    [drafts.data, kind, orgId],
  );

  const controls = useMemo<ComposerDraftControls>(
    () => ({
      items,
      currentId: row.currentId,
      saving: row.saving,
      onLoad: answers.onLoad,
      onDelete: answers.onDelete,
      onKeep: answers.onKeep,
      onDiscard: answers.onDiscard,
    }),
    [answers, items, row.currentId, row.saving],
  );

  return useMemo(
    () => ({ controls, loadGeneration, commit: answers.commit }),
    [answers.commit, controls, loadGeneration],
  );
}

/** Delete a row the composer has let go of, and take it out of the list. */
async function deleteReleased(row: PersistedRow | null, cache: DraftCacheWriters): Promise<void> {
  if (row === null) return;
  cache.remove(row.id);
  await deleteComposerDraft(row.id);
}

/** What the answers need. */
interface DraftAnswerInputs {
  readonly row: DraftRow;
  readonly cache: DraftCacheWriters;
  readonly autosave: { readonly flush: () => void };
  readonly findDraft: (draftId: string) => Promise<ComposerDraftOut>;
  readonly load: (out: ComposerDraftOut) => void;
}

/** The five things a person can do to a draft from the composer. */
interface DraftAnswers {
  readonly onLoad: (draftId: string) => void;
  readonly onDelete: (draftId: string) => void;
  readonly onKeep: () => Promise<void>;
  readonly onDiscard: () => Promise<void>;
  readonly commit: () => Promise<void>;
}

/** The chip's load and delete, the close prompt's two answers, and the create path's commit. */
function useDraftAnswers({
  row,
  cache,
  autosave,
  findDraft,
  load,
}: DraftAnswerInputs): DraftAnswers {
  const onLoad = useCallback(
    (draftId: string): void => {
      autosave.flush();
      void findDraft(draftId).then(load, () => undefined);
    },
    [autosave, findDraft, load],
  );

  const onDelete = useCallback(
    (draftId: string): void => {
      row.forget(draftId);
      cache.remove(draftId);
      void deleteComposerDraft(draftId);
    },
    [cache, row],
  );

  const onKeep = useCallback(async (): Promise<void> => {
    autosave.flush();
    await row.release({ rearm: false });
  }, [autosave, row]);

  const onDiscard = useCallback(async (): Promise<void> => {
    await deleteReleased(await row.release({ rearm: false }), cache);
  }, [cache, row]);

  const commit = useCallback(async (): Promise<void> => {
    await deleteReleased(await row.release({ rearm: true }), cache);
  }, [cache, row]);

  return useMemo(
    () => ({ onLoad, onDelete, onKeep, onDiscard, commit }),
    [commit, onDelete, onDiscard, onKeep, onLoad],
  );
}

/** What the lifecycle effects read. */
interface DraftLifecycleInputs {
  readonly enabled: boolean;
  readonly resumeDraftId: string | null;
  readonly orgId: string | null;
  readonly isDirty: boolean;
  readonly row: DraftRow;
  readonly cache: DraftCacheWriters;
  readonly findDraft: (draftId: string) => Promise<ComposerDraftOut>;
  readonly load: (out: ComposerDraftOut) => void;
  readonly autosave: { readonly flush: () => void };
}

/** The three moments a draft's life is decided outside the keystroke loop. */
function useDraftLifecycle({
  enabled,
  resumeDraftId,
  orgId,
  isDirty,
  row,
  cache,
  findDraft,
  load,
  autosave,
}: DraftLifecycleInputs): void {
  // Load the requested draft once, after the composer mounts with a resolved destination.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || resumeDraftId === null || !enabled) return;
    resumedRef.current = true;
    void findDraft(resumeDraftId).then(load, () => undefined);
  }, [enabled, findDraft, load, resumeDraftId]);

  // A draft belongs to one workspace. Retargeting the composer leaves the old row behind and lets
  // the next edit create one in the new workspace.
  const rowOrgRef = useRef(orgId);
  useEffect(() => {
    if (rowOrgRef.current === orgId) return;
    rowOrgRef.current = orgId;
    void row.release({ rearm: true }).then((previous) => deleteReleased(previous, cache));
  }, [cache, orgId, row]);

  // A composer that unmounts mid-edit (navigation closed it) keeps its last text.
  const latestRef = useRef({ isDirty, flush: autosave.flush, current: row.current });
  latestRef.current = { isDirty, flush: autosave.flush, current: row.current };
  useEffect(
    () => () => {
      if (latestRef.current.isDirty) latestRef.current.flush();
    },
    [],
  );
}
