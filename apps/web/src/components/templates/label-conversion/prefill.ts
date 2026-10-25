'use client';
import { LabelTemplateSuggestionSources } from '@docket/work/template-gallery-contract';
import { useState } from 'react';
import { useApiQuery } from '@/lib/query';
import { labelSuggestionSourcesDef } from '../label-suggestions/queries';

/** Validate optional navigation hints before they can enable a matching-work read. */
export function useConversionLabelPrefill(orgId: string, groupId?: string, labelId?: string) {
  const requested = Boolean(groupId) || Boolean(labelId);
  const query = useApiQuery(labelSuggestionSourcesDef(orgId, requested));
  const [chosen, setChosen] = useState<{ groupId: string; labelId: string } | null>(null);
  const checked = checkedPrefill(query.data, groupId, labelId);
  const value = chosen ?? checked ?? { groupId: '', labelId: '' };
  return {
    value,
    choose: setChosen,
    checking: requested && !chosen && query.isPending,
    unavailable: requested && !chosen && !query.isPending && !checked,
  };
}

function checkedPrefill(data: unknown, groupId?: string, labelId?: string) {
  if (!groupId || !labelId) return null;
  const parsed = LabelTemplateSuggestionSources.safeParse(data);
  if (!parsed.success || parsed.data.availability !== 'available') return null;
  if (!parsed.data.groups.some((group) => group.id === groupId)) return null;
  return parsed.data.labels.some((label) => label.id === labelId && label.groupId === groupId)
    ? { groupId, labelId }
    : null;
}
