'use client';

/**
 * The task's properties sidebar: every property of the task, once, as labelled rows.
 *
 * @remarks
 * Docked beside the body on a wide pane (`EntityDetailLayout`'s aside), where the masthead's chip
 * row renders nothing, so no property is on screen twice. One flush list of 36px rows in reading
 * order — who and what state, where the task sits, how it is labelled, when it happens — with the
 * read-only facts (created, imported from) as a muted footer rather than rows that look editable.
 * Labels share one gutter and values one left edge (`PropertyRow`), and `text-body-medium` is
 * forced onto every trigger so the column reads as one type size. See
 * `docs/design/references/detail-page-layout.md`.
 */
import type { JSX } from 'react';

import { CreatedOriginDate } from '@/components/provenance/created-origin';

import { PropertyRow } from './PropertyRow';
import {
  AssigneeField,
  DueField,
  PriorityField,
  ProjectField,
  StatusField,
  type TaskPropertyModel,
} from './task-masthead-properties';
import { TaskParentField } from './task-parent-field';
import {
  CycleField,
  EstimateField,
  hasEstimate,
  LabelsField,
  MilestoneField,
  OriginLink,
  ProgramField,
  StartField,
  taskProvenanceSubject,
} from './task-secondary-properties';

/**
 * The class every control carries as a row value.
 *
 * @remarks
 * `h-9` matches {@link PropertyRow}'s height, so a control never makes its row taller than a text
 * row; `text-body-medium` overrides the `text-xs` that `Button size="sm"` contributes; and the
 * menu triggers (status, priority) start-align so their glyph sits where every picker's does.
 */
const ROW_CONTROL_CLASS = 'h-9 text-body-medium max-w-full justify-start px-2';

/**
 * Render the properties sidebar.
 *
 * @param props - The page's property model.
 * @returns the labelled property list.
 */
export function TaskPropertiesPanel({ model }: { readonly model: TaskPropertyModel }): JSX.Element {
  const { secondary } = model;
  const field = { model, triggerClassName: ROW_CONTROL_CLASS };
  return (
    <div aria-labelledby="properties-heading" className="text-body-medium flex flex-col gap-4">
      <h2 id="properties-heading" className="sr-only">
        Properties
      </h2>
      <div className="flex flex-col">
        <PropertyRow label="Status">
          <StatusField {...field} />
        </PropertyRow>
        <PropertyRow label="Priority">
          <PriorityField {...field} />
        </PropertyRow>
        <PropertyRow label="Assignee">
          <AssigneeField {...field} />
        </PropertyRow>
        {secondary.delegate ? (
          <PropertyRow label="Delegate">
            <span className="text-on-surface truncate px-2">{secondary.delegate.name}</span>
          </PropertyRow>
        ) : null}
        <PropertyRow label={model.projectLabel}>
          <ProjectField {...field} />
        </PropertyRow>
        <PropertyRow label="Parent">
          <TaskParentField {...field} />
        </PropertyRow>
        {/* A milestone belongs to a project, so the row appears once there is one to choose from. */}
        {model.task.projectId ? (
          <PropertyRow label="Milestone">
            <MilestoneField {...field} />
          </PropertyRow>
        ) : null}
        <PropertyRow label={secondary.cycleLabel}>
          <CycleField {...field} />
        </PropertyRow>
        <PropertyRow label={secondary.programLabel}>
          <ProgramField {...field} />
        </PropertyRow>
        <PropertyRow label="Labels">
          <LabelsField {...field} />
        </PropertyRow>
        <PropertyRow label="Due">
          <DueField {...field} />
        </PropertyRow>
        <PropertyRow label="Anticipated start">
          <StartField {...field} />
        </PropertyRow>
        {hasEstimate(secondary.estimationScale) ? (
          <PropertyRow label="Estimate">
            <EstimateField {...field} />
          </PropertyRow>
        ) : null}
      </div>
      <ProvenanceFooter model={model} />
    </div>
  );
}

/** Created and, for imported work, where it came from: facts, not editable fields. */
function ProvenanceFooter({ model }: { readonly model: TaskPropertyModel }): JSX.Element {
  const { task } = model;
  const provenance = task.provenance;
  return (
    <dl className="text-on-surface-variant text-body-small flex flex-col gap-1">
      <div className="flex gap-3">
        <dt className="w-28 shrink-0">Created</dt>
        <dd>
          <CreatedOriginDate subject={taskProvenanceSubject(task)} createdAt={task.createdAt} />
        </dd>
      </div>
      {provenance.source === 'linked' ? (
        <div className="flex min-w-0 gap-3">
          <dt className="w-28 shrink-0">Imported from</dt>
          <dd className="min-w-0">
            {provenance.externalUrl ? (
              <OriginLink externalUrl={provenance.externalUrl} className="px-0" />
            ) : (
              'An external tool'
            )}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
