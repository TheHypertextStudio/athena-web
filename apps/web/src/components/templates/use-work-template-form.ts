'use client';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  WorkTemplateCreate,
  type WorkTemplateDefinition,
  WorkTemplateOut,
} from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { TeamId } from '@docket/identity-access/ids';
import { useSession } from '@/lib/auth-client';
import { useComposerDraft } from '@/components/composer/use-composer-draft';
import {
  restoreTemplateFormDraft,
  retainTemplateFormDraft,
  templateDraftFingerprint,
  type TemplateFormDraft,
} from './work-template-form-draft';
import { userErrorMessage } from '@/lib/problem';
import { useWorkTemplateWrites } from './work-template-queries';

/** Controlled values and revision-aware actions for the template editor. */
export interface WorkTemplateFormState {
  /** Saved parent identity for contextual returns from linked-definition review. */
  templateId?: string | undefined;
  definition: WorkTemplateDefinition;
  setDefinition: Dispatch<SetStateAction<WorkTemplateDefinition>>;
  kind: TemplateTargetType;
  setKind: Dispatch<SetStateAction<TemplateTargetType>>;
  scope: 'personal' | 'team';
  setScope: Dispatch<SetStateAction<'personal' | 'team'>>;
  teamId: string;
  setTeamId: Dispatch<SetStateAction<string>>;
  offeredTeamIds: string[];
  setOfferedTeamIds: Dispatch<SetStateAction<string[]>>;
  dirty: boolean;
  pending: boolean;
  canEdit: boolean;
  save: () => Promise<void>;
  publish: () => Promise<void>;
  error: string | null;
  saved: boolean;
}

/** Controlled definition editor with revision-aware writes and retained failed drafts. */
export function useWorkTemplateForm(
  orgId: string,
  initial: WorkTemplateOut | null,
  onCreated: (id: string, created: WorkTemplateOut) => void,
  onPublished?: () => void,
): WorkTemplateFormState {
  const state = useTemplateDraftState(orgId, initial);
  const actions = useTemplateActions(orgId, initial, state, onCreated, onPublished);
  const dirty = templateDraftFingerprint(state) !== state.baseline;
  useEffect(() => {
    retainTemplateFormDraft(state.owner, state.cacheKey, state, dirty);
  }, [state, dirty]);
  const canEdit = initial ? initial.canEdit && initial.status !== 'archived' : true;
  useProtectTemplateDraft(dirty);
  return { ...state, ...actions, dirty, canEdit, templateId: initial?.id };
}

function useTemplateDraftState(orgId: string, initial: WorkTemplateOut | null) {
  const { data: session } = useSession();
  const owner = session ? JSON.stringify([session.user.id, session.session.id]) : null;
  const cacheKey = JSON.stringify([orgId, initial?.id ?? 'new']);
  const identity = JSON.stringify([
    owner,
    cacheKey,
    initial?.canEdit ?? true,
    initial?.status === 'archived',
  ]);
  const ownership = useTemplateDraftOwnership(identity);
  const { draft, updateDraft } = useComposerDraft({
    identity,
    ...restoreTemplateFormDraft(owner, cacheKey, initial),
  });
  const state =
    draft.identity === identity
      ? draft
      : {
          identity,
          ...restoreTemplateFormDraft(owner, cacheKey, initial),
        };
  if (draft.identity !== identity) updateDraft(() => state);
  function setter<K extends keyof TemplateFormDraft>(
    key: K,
  ): Dispatch<SetStateAction<TemplateFormDraft[K]>> {
    return (value) => {
      updateDraft((current) => {
        if (current.identity !== identity) return {};
        const patch: Partial<TemplateFormDraft> = {};
        patch[key] = typeof value === 'function' ? value(current[key]) : value;
        return patch;
      });
    };
  }
  return {
    ...state,
    owner,
    cacheKey,
    ...ownership,
    setDefinition: setter('definition'),
    setKind: setter('kind'),
    setScope: setter('scope'),
    setTeamId: setter('teamId'),
    setOfferedTeamIds: setter('offeredTeamIds'),
    setRevision: setter('revision'),
    setBaseline: setter('baseline'),
  };
}

function useTemplateDraftOwnership(identity: string): {
  isCurrent: () => boolean;
  isMounted: () => boolean;
} {
  const mounted = useRef(false);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    isCurrent: () => mounted.current && currentIdentity.current === identity,
    isMounted: () => mounted.current,
  };
}

function useProtectTemplateDraft(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => {
      window.removeEventListener('beforeunload', protectDraft);
    };
  }, [dirty]);
}

function useTemplateActions(
  orgId: string,
  initial: WorkTemplateOut | null,
  state: ReturnType<typeof useTemplateDraftState>,
  onCreated: (id: string, created: WorkTemplateOut) => void,
  onPublished?: () => void,
) {
  const writes = useWorkTemplateWrites(orgId, 'silent');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const writing = useRef(false);
  const [locallyPending, setLocallyPending] = useState(false);
  const pending = locallyPending || Object.values(writes).some((write) => write.isPending);
  async function save(): Promise<void> {
    if (!state.isCurrent() || writing.current || pending) return;
    writing.current = true;
    setLocallyPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = WorkTemplateOut.parse(
        initial
          ? await writes.draft.mutateAsync({
              id: initial.id,
              expectedRevision: state.revision,
              definition: state.definition,
              offeredTeamIds: state.offeredTeamIds.map((id) => TeamId.parse(id)),
            })
          : await writes.create.mutateAsync(
              WorkTemplateCreate.parse({
                targetType: state.kind,
                scope: state.scope,
                definition: state.definition,
                offeredTeamIds: state.offeredTeamIds,
                ...(state.scope === 'team' ? { teamId: state.teamId } : {}),
              }),
            ),
      );
      if (!state.isCurrent()) return;
      state.setRevision(result.revision);
      state.setBaseline(templateDraftFingerprint(state));
      setSaved(true);
      if (!initial) onCreated(result.id, result);
    } catch (caught) {
      if (!state.isCurrent()) return;
      setError(
        userErrorMessage(caught, 'Could not save the template draft. Your changes are still here.'),
      );
    } finally {
      writing.current = false;
      if (state.isMounted()) setLocallyPending(false);
    }
  }
  async function publish(): Promise<void> {
    if (!state.isCurrent() || !initial || writing.current || pending) return;
    writing.current = true;
    setLocallyPending(true);
    setError(null);
    try {
      const result = WorkTemplateOut.parse(
        await writes.publish.mutateAsync({ id: initial.id, expectedRevision: state.revision }),
      );
      if (!state.isCurrent()) return;
      state.setRevision(result.revision);
      setSaved(true);
      onPublished?.();
    } catch (caught) {
      if (!state.isCurrent()) return;
      setError(userErrorMessage(caught, 'Could not publish the template.'));
    } finally {
      writing.current = false;
      if (state.isMounted()) setLocallyPending(false);
    }
  }
  return { save, publish, error, saved, pending };
}
