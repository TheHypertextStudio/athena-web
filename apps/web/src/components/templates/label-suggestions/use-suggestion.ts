'use client';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import {
  LabelTemplateSuggestionSources,
  type LabelTemplateSuggestionSelection,
} from '@docket/work/template-gallery-contract';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError } from '@/lib/problem';
import { useApiQuery } from '@/lib/query';
import {
  labelSuggestionSourcesDef,
  useLabelSuggestionPreview,
  useLabelSuggestionRequest,
} from './queries';

/** Plain, explicit source choices; generation never receives caller-authored source text. */
export type LabelSuggestionSelection = z.input<typeof LabelTemplateSuggestionSelection>;
/** Retain one reviewed checkpoint and one real saved request within the current account scope. */
export function useLabelSuggestion(orgId: string, requestId: string) {
  const sources = useApiQuery(labelSuggestionSourcesDef(orgId));
  const preview = useLabelSuggestionPreview(orgId),
    request = useLabelSuggestionRequest(orgId);
  const router = useAppRouter();
  const [selection, setSelection] = useState<LabelSuggestionSelection>({
    labelGroupId: '',
    labelId: '',
    kind: 'task',
    workIds: [],
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState('');
  const sourceRevoked = selectionUnavailable(sources.data, selection);
  const resetPreview = preview.reset;
  useEffect(() => {
    if (!sourceRevoked) return;
    setSelection((current) => ({ ...current, labelGroupId: '', labelId: '', workIds: [] }));
    resetPreview();
    setFailure('That label is no longer available. Choose another label to continue.');
  }, [sourceRevoked, resetPreview]);
  function change(value: LabelSuggestionSelection): void {
    setSelection(value);
    preview.reset();
    setFailure(null);
  }
  async function review(): Promise<void> {
    setFailure(null);
    try {
      await preview.mutateAsync(selection);
    } catch {
      setFailure('These examples could not be reviewed. Check your selection and try again.');
    }
  }
  async function ask(): Promise<void> {
    if (!preview.data) return;
    setFailure(null);
    try {
      const saved = await request.mutateAsync({
        ...selection,
        fingerprint: preview.data.fingerprint,
      });
      setSubmitted(saved.sessionId);
      router.replace(
        `/orgs/${orgId}/work-templates/suggest-from-labels?requestId=${saved.sessionId}`,
        { scroll: false },
      );
    } catch (error) {
      setFailure(
        error instanceof UserFacingError && error.status === 409
          ? 'These examples changed. Review your selection again.'
          : 'This request could not be started. Try again; the saved request will be reused.',
      );
      preview.reset();
    }
  }
  function chooseAgain(): void {
    setSubmitted('');
    preview.reset();
    setFailure(null);
    router.replace(`/orgs/${orgId}/work-templates/suggest-from-labels`, { scroll: false });
  }
  return {
    sources,
    sourceRevoked,
    selection,
    failure,
    preview,
    request,
    id: submitted || requestId,
    change,
    review,
    ask,
    chooseAgain,
  };
}

function selectionUnavailable(data: unknown, selection: LabelSuggestionSelection): boolean {
  if (!selection.labelGroupId) return false;
  const parsed = LabelTemplateSuggestionSources.safeParse(data);
  if (!parsed.success) return false;
  if (parsed.data.availability !== 'available') return true;
  if (!parsed.data.groups.some((group) => group.id === selection.labelGroupId)) return true;
  return (
    !!selection.labelId &&
    !parsed.data.labels.some(
      (label) => label.id === selection.labelId && label.groupId === selection.labelGroupId,
    )
  );
}
