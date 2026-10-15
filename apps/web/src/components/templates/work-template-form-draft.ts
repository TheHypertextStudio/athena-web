import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateDefinition, WorkTemplateOut } from '@docket/work/work-template-contract';

/** Editable fields retained for one account's interrupted template editor. */
export interface TemplateFormDraft {
  definition: WorkTemplateDefinition;
  kind: TemplateTargetType;
  scope: 'personal' | 'team';
  teamId: string;
  offeredTeamIds: string[];
  revision: number;
  baseline: string;
}

// Private prose lives only in this tab's memory. An account/session change drops every entry.
let activeOwner: string | null = null;
const drafts = new Map<string, TemplateFormDraft>();

/** Compare every editable field, excluding server revision and other bookkeeping. */
export function templateDraftFingerprint(
  draft: Omit<TemplateFormDraft, 'revision' | 'baseline'>,
): string {
  return JSON.stringify({
    definition: draft.definition,
    kind: draft.kind,
    scope: draft.scope,
    teamId: draft.teamId,
    offeredTeamIds: draft.offeredTeamIds,
  });
}

/** Start from current authorized server data, with an identical untouched baseline. */
function freshDraft(initial: WorkTemplateOut | null): TemplateFormDraft {
  const values: Omit<TemplateFormDraft, 'revision' | 'baseline'> = initial
    ? {
        definition: initial.draftDefinition ?? initial.definition,
        kind: initial.targetType,
        scope: initial.scope === 'team' ? 'team' : 'personal',
        teamId: initial.teamId ?? '',
        offeredTeamIds: initial.offeredTeamIds,
      }
    : {
        definition: {
          name: '',
          description: null,
          icon: null,
          defaultStatusKey: null,
          payload: { targetType: 'project' },
          blueprint: { steps: [], dependencies: [] },
          defaultSchedules: [],
        },
        kind: 'project',
        scope: 'personal',
        teamId: '',
        offeredTeamIds: [],
      };
  return {
    ...values,
    revision: initial?.revision ?? 0,
    baseline: templateDraftFingerprint(values),
  };
}

/** Resume an authorized draft without allowing another session or a reader to see cached prose. */
export function restoreTemplateFormDraft(
  owner: string | null,
  key: string,
  initial: WorkTemplateOut | null,
): TemplateFormDraft {
  if (owner !== activeOwner) {
    drafts.clear();
    activeOwner = owner;
  }
  if (initial && (!initial.canEdit || initial.status === 'archived')) drafts.delete(key);
  return (owner === null ? undefined : drafts.get(key)) ?? freshDraft(initial);
}

/** Retain unsaved edits during navigation, and forget a draft once its save succeeds. */
export function retainTemplateFormDraft(
  owner: string | null,
  key: string,
  draft: TemplateFormDraft,
  dirty: boolean,
): void {
  if (owner === null || owner !== activeOwner) return;
  if (dirty) drafts.set(key, draft);
  else drafts.delete(key);
}
