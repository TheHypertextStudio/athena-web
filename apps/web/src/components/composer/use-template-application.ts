'use client';
import { useState } from 'react';
import type {
  TemplateDraft,
  TemplateOut,
  TemplateTargetType,
} from '@docket/work/template-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import { useApiQuery } from '@/lib/query';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { statusSetsDef } from '@/components/statuses/queries';
import {
  templateMerge,
  type PartialWithUndefined,
  type TemplateMergeRule,
} from '@/components/templates/merge';
import { templateStartingStatus } from './template-starting-status';

interface Selection {
  payload: TemplateDraft;
  workTypeId: string | null;
  workTypeVersionId: string | null;
  name: string;
  status?: string | undefined;
}

/** Creation-time selection with explicit ownership of authored fields. */
export interface TemplateApplication {
  readonly publications: readonly WorkTemplateOut[] | undefined;
  readonly ready: boolean;
  readonly pendingName: string | null;
  readonly startingDraft: string | null;
  readonly choose: (template: WorkTemplateOut, status?: string) => void;
  readonly legacy: (template: TemplateOut, automatic?: boolean) => void;
  readonly confirm: (fields: boolean) => void;
  readonly cancel: () => void;
}

/** Reuse canonical publication/status defaults for top-row, inline and command launches. */
export function useTemplateApplication<T extends object>({
  orgId,
  kind,
  teamId,
  open,
  updateDraft,
  patch,
  rule,
}: {
  orgId: string;
  kind: TemplateTargetType;
  teamId: string | null;
  open: boolean;
  updateDraft: (recipe: (current: T) => Partial<T>) => void;
  patch: (payload: TemplateDraft) => PartialWithUndefined<T>;
  rule: TemplateMergeRule<T>;
}): TemplateApplication {
  const definitions = useApiQuery({
    ...workTemplatesDef(orgId, { targetType: kind }),
    enabled: open,
  });
  const statuses = useApiQuery({
    ...statusSetsDef(orgId, kind === 'task' ? (teamId ?? undefined) : undefined),
    enabled: open,
  });
  const [pending, setPending] = useState<Selection | null>(null);
  const [startingDraft, setStartingDraft] = useState<string | null>(null);
  function apply(chosen: Selection, fields: boolean): void {
    updateDraft((current) => {
      const fieldsPatch: Partial<T> = fields
        ? templateMerge(current, patch(chosen.payload), rule)
        : {};
      return {
        ...fieldsPatch,
        ...(fields && chosen.status
          ? { [kind === 'task' ? 'state' : 'status']: chosen.status }
          : {}),
        workTypeId: chosen.workTypeId,
        workTypeVersionId: chosen.workTypeVersionId,
        blueprint: undefined,
      };
    });
    setStartingDraft(chosen.workTypeId ? null : chosen.name);
    setPending(null);
  }
  function legacy(chosen: TemplateOut, automatic = false): void {
    const published = definitions.data?.items.find(
      (item) => item.id === chosen.id && item.latestVersion,
    );
    if (chosen.scope === 'organization' && chosen.workTypeVersionId && !published) return;
    const candidate = published
      ? selectionOf(
          published,
          templateStartingStatus(published, statuses.data?.items ?? [], teamId),
        )
      : { payload: chosen.payload, workTypeId: null, workTypeVersionId: null, name: chosen.name };
    if (automatic) apply(candidate, true);
    else setPending(candidate);
  }
  return {
    publications: definitions.data?.items,
    ready: definitions.isSuccess && statuses.isSuccess,
    pendingName: pending?.name ?? null,
    startingDraft,
    choose: (chosen, status) => {
      setPending(selectionOf(chosen, status));
    },
    legacy,
    confirm: (fields) => {
      if (pending) apply(pending, fields);
    },
    cancel: () => {
      setPending(null);
    },
  };
}
function selectionOf(chosen: WorkTemplateOut, status?: string): Selection {
  return {
    payload: chosen.definition.payload,
    workTypeId: chosen.id,
    workTypeVersionId: chosen.latestVersion?.id ?? null,
    name: chosen.definition.name,
    status,
  };
}
