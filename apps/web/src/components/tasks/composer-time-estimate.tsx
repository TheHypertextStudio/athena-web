'use client';

/**
 * `tasks/composer-time-estimate` — the task composer's time-estimate chip.
 *
 * @remarks
 * Always offered: the time estimate reads no workspace setting, unlike points. Until a time is
 * picked, the chip shows the one a `~` token in the title names (`~45m`), which is what the task
 * will be created with; see {@link draftTitleEstimate}. Clearing the chip takes that token out of
 * the title too, so a cleared estimate stays cleared.
 */
import type { JSX } from 'react';

import { EstimateTimePicker } from '@/components/pickers/estimate-time-picker';
import { EntityMetadataItem } from '@/components/views/entity-detail-layout';
import { parseTitleEstimate } from '@/lib/parse-estimate';

import { draftTitleEstimate } from './task-create-body';

/** Props for {@link ComposerTimeEstimate}. */
export interface ComposerTimeEstimateProps {
  /** The draft title, which may carry a `~` token. */
  readonly title: string;
  /** The picked time estimate in minutes, or `null` when none was picked. */
  readonly value: number | null;
  /** Report a picked time estimate, or `null` when cleared. */
  readonly onChange: (minutes: number | null) => void;
  /** Replace the draft title; clearing uses it to take out a `~` token. */
  readonly onTitleChange: (title: string) => void;
  /** Disable the chip while the task is being created. */
  readonly disabled: boolean;
}

/** The composer's time-estimate chip, in the metadata row beside the other properties. */
export function ComposerTimeEstimate({
  title,
  value,
  onChange,
  onTitleChange,
  disabled,
}: ComposerTimeEstimateProps): JSX.Element {
  const { estimateMinutes } = draftTitleEstimate({ title, estimateMinutes: value });
  return (
    <EntityMetadataItem priority={7}>
      <EstimateTimePicker
        value={estimateMinutes}
        onChange={(minutes) => {
          const token = minutes === null ? parseTitleEstimate(title) : null;
          if (token !== null && token.title !== '') onTitleChange(token.title);
          onChange(minutes);
        }}
        placeholder="No time estimate"
        disabled={disabled}
      />
    </EntityMetadataItem>
  );
}
