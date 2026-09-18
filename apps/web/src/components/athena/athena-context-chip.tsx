'use client';

/**
 * The chip above an Athena composer that shows which page is attached to the next message.
 *
 * Attached: "Fall fundraiser launch · Project" with a remove control. Detached: an assist
 * chip that reattaches the page. No context, nothing rendered.
 */
import { Sparkles } from '@docket/ui/icons';
import { Chip } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** Plain names for each source kind. */
const KIND_LABEL: Readonly<Record<PersonalAthenaSource['type'], string>> = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
  program: 'Program',
  calendar_item: 'Calendar',
  stream_event: 'Inbox item',
};

/** The name the chip shows for a context, or null when it has nothing nameable. */
export function contextChipLabel(context: PersonalAthenaContext): string | null {
  return context.source?.label ?? context.workspaceName ?? null;
}

/** Props for {@link AthenaContextChip}. */
export interface AthenaContextChipProps {
  readonly context: PersonalAthenaContext | null;
  readonly attached: boolean;
  readonly onDetach: () => void;
  readonly onAttach: () => void;
}

/** Show the attached page and let the person detach or reattach it. */
export function AthenaContextChip({
  context,
  attached,
  onDetach,
  onAttach,
}: AthenaContextChipProps): JSX.Element | null {
  if (!context) return null;
  const label = contextChipLabel(context);
  if (!label) return null;
  const kind = context.source ? KIND_LABEL[context.source.type] : 'Workspace';

  if (!attached) {
    return (
      <Chip variant="assist" icon={<Sparkles aria-hidden="true" />} onClick={onAttach}>
        Include {label}
      </Chip>
    );
  }
  return (
    <div role="group" aria-label={`${label}, ${kind}`} className="flex max-w-full min-w-0">
      <Chip
        variant="input"
        icon={<Sparkles aria-hidden="true" />}
        onRemove={onDetach}
        removeLabel={`Remove ${label}`}
        className="max-w-full min-w-0 shrink"
      >
        <span className="truncate">{label}</span>
        <span className="text-on-surface-variant shrink-0"> · {kind}</span>
      </Chip>
    </div>
  );
}
