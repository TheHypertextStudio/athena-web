'use client';
import { useRef, useState } from 'react';
import type { WorkScheduleCreate, WorkScheduleOut } from '@docket/work/work-schedule-management';
import { useApiQuery, useApiListQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useDiscardPrompt } from '@/components/composer/use-discard-prompt';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import {
  initialScheduleDraft,
  scheduleCreateInput,
  scheduleRevisionMinimumDate,
} from './schedule-draft';
import { schedulePreviewDef } from './work-schedule-queries';

/** The saved revision being refined, or a new Program-owned routine. */
export interface ScheduleEditorProps {
  readonly orgId: string;
  readonly programId: string;
  readonly programName: string;
  readonly schedule?: WorkScheduleOut | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: WorkScheduleCreate) => Promise<void>;
}
/** Keep all sections' input and the exact reviewed revision while handling failed saves. */
export function useScheduleEditor(props: ScheduleEditorProps) {
  const [today] = useState(() => scheduleToday(props.schedule));
  const minimumDate = scheduleRevisionMinimumDate(today, props.schedule);
  const [draft, setDraft] = useState(() =>
    initialScheduleDraft(
      today,
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      props.schedule,
    ),
  );
  const baseline = useRef(JSON.stringify(draft));
  const [section, setSection] = useState('schedule-work');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input =
    draft.effectiveFrom < minimumDate ? null : scheduleCreateInput(draft, props.programId);
  const options = useComposerOptions(props.orgId, ['actors', 'teams'], props.open);
  const templates = useApiQuery(
    workTemplatesDef(props.orgId, { targetType: draft.kind, includeArchived: true }),
  );
  const preview = useApiListQuery(
    schedulePreviewDef(props.orgId, input, section !== 'schedule-repeat', props.schedule),
  );
  const prompt = useDiscardPrompt({
    creating: saving,
    contentDisabled: false,
    canSubmit: input !== null,
    isDirty: JSON.stringify(draft) !== baseline.current,
    onOpenChange: props.onOpenChange,
  });
  const selected = templates.data?.items.find(
    (item) => item.id === draft.document?.template.workTypeId,
  );
  const retainedTemplate = retainedForDraft(props.schedule, draft);
  const ready = Boolean(
    input && preview.data && !preview.isError && !preview.isFetching && !preview.isPlaceholderData,
  );
  const selectSection = (next: string, focus = false): void => {
    setSection(next);
    if (focus)
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#tabpanel-${next} h2`)?.focus();
      });
  };
  const submit = async (): Promise<void> => {
    if (!input || !ready || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await props.onSubmit(input);
      props.onOpenChange(false);
    } catch (error) {
      setFailure(
        userErrorMessage(error, 'Could not save this schedule. Your choices are kept. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return {
    today,
    minimumDate,
    draft,
    setDraft,
    section,
    saving,
    failure,
    input,
    options,
    preview,
    prompt,
    selected,
    retainedTemplate,
    ready,
    selectSection,
    submit,
  };
}

function retainedForDraft(
  schedule: WorkScheduleOut | undefined,
  draft: ReturnType<typeof initialScheduleDraft>,
) {
  if (!schedule?.templateArchived || schedule.revision.document?.kind !== 'schedule') return null;
  if (schedule.revision.document.template.workTypeId !== draft.document?.template.workTypeId)
    return null;
  return schedule.retainedTemplate;
}

function scheduleToday(schedule: WorkScheduleOut | undefined): string {
  const document = schedule?.revision.document;
  const timeZone =
    document?.kind === 'schedule'
      ? document.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
