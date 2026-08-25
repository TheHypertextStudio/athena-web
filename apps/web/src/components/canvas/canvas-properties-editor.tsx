'use client';

/** Shared atomic bulk Properties editor for homogeneous Project and Task canvas selections. */
import type { PlanningTimeframe } from '@docket/work/planning-timeframe';
import {
  ActorPicker,
  DatePicker,
  EntityPicker,
  EnumPicker,
  TimeframePicker,
  type PickerOption,
} from '@docket/ui/components';
import { Button, Checkbox } from '@docket/ui/primitives';

import { HEALTH_OPTIONS, PRIORITY_OPTIONS, statusOptions } from '@/components/pickers/options';
import { useComposerOptions } from '@/components/pickers/use-composer-options';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { EstimatePicker } from '@/components/task-detail/EstimatePicker';
import type { CanvasPropertySnapshot } from '@/lib/actions';
import { formatPlanningTimeframe, toPlanningTimeframe } from '@/lib/planning-timeframe';
import { useEstimationScale } from '@/lib/use-estimation-scale';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';

import { useCanvasCommandContext } from './canvas-command-context';
import {
  aggregateAssociation,
  aggregateScalar,
  buildAssociationCommand,
  buildAssociationRemovalCommand,
  buildScalarCommand,
  commonNonNullValue,
  compatibleLabels,
  guardCanvasPropertySelection,
  intersectTaskStatusKeys,
  type CanvasScalarProperty,
  type ScalarAggregation,
} from './canvas-properties-model';
import { canvasCommandId } from './use-canvas-command-history';

const OPTION_KINDS = [
  'actors',
  'projects',
  'programs',
  'initiatives',
  'labels',
  'cycles',
  'milestones',
  'teams',
] as const;

/** Props for {@link CanvasPropertiesEditor}. */
export interface CanvasPropertiesEditorProps {
  /** Active snapshots derived from the selected object ids. */
  readonly snapshots: readonly CanvasPropertySnapshot[];
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={`${label} property`} className="grid gap-1 py-1">
      <span className="text-label-medium text-on-surface-variant">{label}</span>
      {children}
    </div>
  );
}

function SourceError({
  message,
  retryLabel,
  onRetry,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="bg-error-container text-on-error-container flex items-center justify-between gap-2 rounded-lg px-3 py-2">
      <p className="text-body-small" role="alert">
        {message}
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function scalarValue<T>(aggregation: ScalarAggregation<T>): T | null {
  return aggregation.state === 'same' ? aggregation.value : null;
}

function scalarPlaceholder<T>(aggregation: ScalarAggregation<T>, placeholder: string): string {
  return aggregation.state === 'mixed' ? 'Mixed' : placeholder;
}

function timeframeCommandValue(value: PlanningTimeframe | null): {
  readonly date: string | null;
  readonly resolution: PlanningTimeframe['resolution'];
} {
  return value === null
    ? { date: null, resolution: null }
    : { date: value.date, resolution: value.resolution };
}

function sameTimeframe(left: PlanningTimeframe | null, right: PlanningTimeframe | null): boolean {
  return (
    left?.date === right?.date &&
    left?.resolution === right?.resolution &&
    left?.fiscalYearStartMonth === right?.fiscalYearStartMonth
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanizeValue(value: string): string {
  const words = value.replaceAll(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type CanvasScalarFeedbackValue =
  | string
  | number
  | null
  | {
      readonly date: string | null;
      readonly resolution: PlanningTimeframe['resolution'];
    };

function AssociationField({
  label,
  noun,
  snapshots,
  options,
  association,
  read,
  disabled,
  onToggle,
  removeOnlyIds,
  onRemove,
}: {
  readonly label: string;
  readonly noun: 'Task' | 'Project';
  readonly snapshots: readonly CanvasPropertySnapshot[];
  readonly options: readonly PickerOption[];
  readonly association: 'label' | 'initiative';
  readonly read: (snapshot: CanvasPropertySnapshot) => readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (association: 'label' | 'initiative', id: string, label: string) => void;
  readonly removeOnlyIds?: ReadonlySet<string> | undefined;
  readonly onRemove: (association: 'label' | 'initiative', id: string, label: string) => void;
}): React.JSX.Element {
  const plural = snapshots.length === 1 ? noun : `${noun}s`;
  return (
    <Field label={label}>
      <div className="border-outline-variant max-h-40 overflow-y-auto rounded-lg border p-1">
        {options.length === 0 ? (
          <p className="text-body-small text-on-surface-variant px-2 py-1">No valid choices.</p>
        ) : (
          options.map((option) => {
            const state = aggregateAssociation(snapshots, option.value, read);
            const removeOnly = state === 'some' && removeOnlyIds?.has(option.value) === true;
            const copy =
              state === 'all'
                ? `All selected ${plural} have ${option.label}. Clear to remove it from all.`
                : state === 'some'
                  ? removeOnly
                    ? `Some selected ${plural} have ${option.label}. It is not valid for the full selection.`
                    : `Some selected ${plural} have ${option.label}. Select to add it to all.`
                  : `No selected ${plural} have ${option.label}. Select to add it to all.`;
            return (
              <div
                key={option.value}
                className="hover:bg-surface-container-high flex min-h-10 items-start gap-2 rounded-md px-2 py-1.5"
              >
                <Checkbox
                  checked={state === 'all'}
                  indeterminate={state === 'some'}
                  disabled={disabled || removeOnly}
                  aria-label={`${option.label} — ${state}`}
                  onChange={() => {
                    onToggle(association, option.value, option.label);
                  }}
                />
                <span className="min-w-0">
                  <span className="text-body-medium text-on-surface flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                  <span className="text-body-small text-on-surface-variant block">{copy}</span>
                </span>
                {removeOnly ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Remove ${option.label} from selected`}
                    onClick={() => {
                      onRemove(association, option.value, option.label);
                    }}
                  >
                    Remove from selected
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </Field>
  );
}

/** Render the complete approved catalog and issue every mutation through one canvas command. */
export default function CanvasPropertiesEditor({
  snapshots,
}: CanvasPropertiesEditorProps): React.JSX.Element {
  const commands = useCanvasCommandContext();
  const guard = guardCanvasPropertySelection(snapshots);
  const selectedCount = commands?.selectedObjects.length ?? snapshots.length;
  const selectionIssue =
    selectedCount > 500
      ? 'Properties supports at most 500 selected objects.'
      : selectedCount !== snapshots.length
        ? 'The selection is no longer available.'
        : guard.ok
          ? null
          : guard.reason;
  const organizationId = snapshots[0]?.organizationId ?? '';
  const options = useComposerOptions(organizationId, OPTION_KINDS, organizationId.length > 0);
  const registry = useStatusRegistry();
  const estimation = useEstimationScale(organizationId, organizationId.length > 0);
  const planning = useFiscalYearStartMonth(organizationId, organizationId.length > 0);
  const disabled =
    commands === null || !commands.canEdit || commands.pending || selectionIssue !== null;
  const optionDisabled = (kind: (typeof OPTION_KINDS)[number]): boolean =>
    disabled || options.loading || options.failedKinds.has(kind);
  const first = snapshots[0];
  const kind = first?.kind ?? commands?.objectKind ?? 'task';
  const subject =
    selectedCount === 1
      ? (commands?.selectedObjects[0]?.title ?? (kind === 'task' ? 'Task' : 'Project'))
      : `${String(selectedCount)} ${kind === 'task' ? 'tasks' : 'projects'}`;
  const subjectVerb = selectedCount === 1 ? 'is' : 'are';
  const labelForScalarValue = (
    property: CanvasScalarProperty,
    value: CanvasScalarFeedbackValue,
    label: string,
  ) => {
    if (value === null || (typeof value === 'object' && value.date === null)) {
      return `No ${label}`;
    }
    const fieldOptions: readonly PickerOption[] = (() => {
      switch (property) {
        case 'state':
          return statusOptions(
            snapshots.flatMap((snapshot) =>
              snapshot.kind === 'task' ? registry.statusesFor('task', snapshot.teamId) : [],
            ),
          );
        case 'status':
          return statusOptions(registry.statusesFor('project'));
        case 'priority':
          return PRIORITY_OPTIONS;
        case 'health':
          return HEALTH_OPTIONS;
        case 'assigneeId':
        case 'leadId':
          return property === 'leadId' ? options.memberOptions : options.actorOptions;
        case 'projectId':
          return options.projectOptions;
        case 'programId':
          return options.programOptions;
        case 'milestoneId':
          return options.milestones.map((item) => ({ value: item.id, label: item.name }));
        case 'cycleId':
          return options.cycles.map((item) => ({ value: item.id, label: item.displayName }));
        case 'teamId':
          return options.teamOptions;
        default:
          return [];
      }
    })();
    const option = fieldOptions.find(({ value: optionValue }) => optionValue === value);
    if (option !== undefined) return option.label;
    if (typeof value === 'object') {
      return (
        formatPlanningTimeframe(
          toPlanningTimeframe(value.date, value.resolution, planning.fiscalYearStartMonth),
        ) ?? `No ${label}`
      );
    }
    return typeof value === 'string' ? humanizeValue(value) : value.toString();
  };

  const executeScalar = (
    property: CanvasScalarProperty,
    value: CanvasScalarFeedbackValue,
    label: string,
  ): void => {
    if (commands === null || disabled) return;
    const valueLabel = labelForScalarValue(property, value, label);
    void commands.execute(buildScalarCommand(snapshots, property, value, canvasCommandId()), {
      historyLabel: `Change ${label}`,
      title: `${titleCase(label)} changed`,
      detail:
        label.toLowerCase() === 'status'
          ? `${subject} ${subjectVerb} now ${valueLabel}`
          : `${subject} ${subjectVerb} now set to ${valueLabel}`,
      unchangedTitle: `${titleCase(label)} unchanged`,
      unchangedDetail:
        label.toLowerCase() === 'status'
          ? `${subject} ${subjectVerb} already ${valueLabel}`
          : `${subject} ${subjectVerb} already set to ${valueLabel}`,
    });
  };
  const executeAssociation = (
    association: 'label' | 'initiative',
    id: string,
    label: string,
  ): void => {
    if (commands === null || disabled) return;
    void commands.execute(buildAssociationCommand(snapshots, association, id, canvasCommandId()), {
      historyLabel: `Add ${label}`,
      title: `${titleCase(association)} added`,
      detail: `${subject} now ${selectedCount === 1 ? 'has' : 'have'} ${label}`,
      unchangedTitle: `${titleCase(association)} unchanged`,
      unchangedDetail: `${subject} already ${selectedCount === 1 ? 'has' : 'have'} ${label}`,
    });
  };
  const executeAssociationRemoval = (
    association: 'label' | 'initiative',
    id: string,
    label: string,
  ): void => {
    if (commands === null || disabled) return;
    void commands.execute(
      buildAssociationRemovalCommand(snapshots, association, id, canvasCommandId()),
      {
        historyLabel: `Remove ${label}`,
        title: `${titleCase(association)} removed`,
        detail: `${subject} no longer ${selectedCount === 1 ? 'has' : 'have'} ${label}`,
        unchangedTitle: `${titleCase(association)} unchanged`,
        unchangedDetail: `${subject} did not ${selectedCount === 1 ? 'have' : 'have'} ${label}`,
      },
    );
  };

  if (first === undefined) {
    return <p className="text-body-small text-on-surface-variant">{selectionIssue}</p>;
  }

  const labelRecords = compatibleLabels(snapshots, options.labels);
  const validLabelIds = new Set<string>(labelRecords.map(({ id }) => id));
  const validLabelOptions = options.labelOptions.filter(
    ({ value }) =>
      validLabelIds.has(value) ||
      aggregateAssociation(snapshots, value, (snapshot) => snapshot.labelIds) !== 'none',
  );
  const removeOnlyLabelIds = new Set(
    validLabelOptions.filter(({ value }) => !validLabelIds.has(value)).map(({ value }) => value),
  );

  if (first.kind === 'task') {
    const tasks = snapshots.filter(
      (snapshot): snapshot is Extract<CanvasPropertySnapshot, { kind: 'task' }> =>
        snapshot.kind === 'task',
    );
    const state = aggregateScalar(tasks, (task) => task.state);
    const priority = aggregateScalar(tasks, (task) => task.priority);
    const assignee = aggregateScalar(tasks, (task) => task.assigneeId);
    const project = aggregateScalar(tasks, (task) => task.projectId);
    const program = aggregateScalar(tasks, (task) => task.programId);
    const milestone = aggregateScalar(tasks, (task) => task.milestoneId);
    const cycle = aggregateScalar(tasks, (task) => task.cycleId);
    const start = aggregateScalar(tasks, (task) => task.startDate);
    const due = aggregateScalar(tasks, (task) => task.dueDate);
    const estimate = aggregateScalar(tasks, (task) => task.estimate);
    const statusKeys = intersectTaskStatusKeys(tasks, (teamId) =>
      registry.statusesFor('task', teamId).map(({ key }) => key),
    );
    const statusKeySet = new Set(statusKeys);
    const statusPickerOptions = statusOptions(
      registry.statusesFor('task', tasks[0]?.teamId).filter(({ key }) => statusKeySet.has(key)),
    );
    const projectId = commonNonNullValue(tasks, (task) => task.projectId);
    const teamId = commonNonNullValue(tasks, (task) => task.teamId);
    const milestoneOptions = options.milestones
      .filter((item) => projectId !== null && item.projectId === projectId)
      .map((item) => ({ value: item.id, label: item.name }));
    const cycleOptions = options.cycles
      .filter((item) => teamId !== null && item.teamId === teamId)
      .map((item) => ({ value: item.id, label: item.displayName }));
    return (
      <>
        {selectionIssue !== null ? (
          <p className="text-body-medium text-error">{selectionIssue}</p>
        ) : null}
        {options.error != null ? (
          <SourceError
            message={options.error}
            retryLabel="Retry property choices"
            onRetry={options.retry}
          />
        ) : null}
        <Field label="Status">
          <EnumPicker
            options={statusPickerOptions}
            value={scalarValue(state)}
            onChange={(value) => {
              if (value !== null) executeScalar('state', value, 'status');
            }}
            placeholder={scalarPlaceholder(state, 'Set status')}
            ariaLabel="Status"
            disabled={disabled || !registry.loaded || registry.error != null}
          />
          {registry.error != null ? (
            <SourceError
              message={registry.error}
              retryLabel="Retry statuses"
              onRetry={registry.retry}
            />
          ) : null}
        </Field>
        <Field label="Priority">
          <EnumPicker
            options={PRIORITY_OPTIONS}
            value={scalarValue(priority)}
            onChange={(value) => {
              if (value !== null) executeScalar('priority', value, 'priority');
            }}
            placeholder={scalarPlaceholder(priority, 'Set priority')}
            ariaLabel={priority.state === 'mixed' ? 'Priority — Mixed' : 'Priority'}
            disabled={disabled}
          />
        </Field>
        <Field label="Assignee">
          <ActorPicker
            options={options.actorOptions}
            value={scalarValue(assignee)}
            onChange={(value) => {
              executeScalar('assigneeId', value, 'assignee');
            }}
            placeholder={scalarPlaceholder(assignee, 'Assign')}
            clearLabel="Unassigned"
            ariaLabel="Assignee"
            disabled={optionDisabled('actors')}
          />
        </Field>
        <Field label="Project">
          <EntityPicker
            options={options.projectOptions}
            value={scalarValue(project)}
            onChange={(value) => {
              executeScalar('projectId', value, 'Project');
            }}
            placeholder={scalarPlaceholder(project, 'Set Project')}
            clearLabel="No Project"
            ariaLabel="Project"
            disabled={optionDisabled('projects')}
          />
        </Field>
        <Field label="Program">
          <EntityPicker
            options={options.programOptions}
            value={scalarValue(program)}
            onChange={(value) => {
              executeScalar('programId', value, 'Program');
            }}
            placeholder={scalarPlaceholder(program, 'Set Program')}
            clearLabel="No Program"
            ariaLabel="Program"
            disabled={optionDisabled('programs')}
          />
        </Field>
        <Field label="Milestone">
          <EntityPicker
            options={milestoneOptions}
            value={scalarValue(milestone)}
            onChange={(value) => {
              executeScalar('milestoneId', value, 'milestone');
            }}
            placeholder={scalarPlaceholder(
              milestone,
              projectId === null ? 'Select Tasks in one Project' : 'Set milestone',
            )}
            clearLabel="No milestone"
            ariaLabel="Milestone"
            disabled={optionDisabled('milestones')}
          />
        </Field>
        <Field label="Cycle">
          <EntityPicker
            options={cycleOptions}
            value={scalarValue(cycle)}
            onChange={(value) => {
              executeScalar('cycleId', value, 'cycle');
            }}
            placeholder={scalarPlaceholder(
              cycle,
              teamId === null ? 'Select Tasks on one Team' : 'Set cycle',
            )}
            clearLabel="No cycle"
            ariaLabel="Cycle"
            disabled={optionDisabled('cycles')}
          />
        </Field>
        <AssociationField
          label="Labels"
          noun="Task"
          snapshots={tasks}
          options={validLabelOptions}
          association="label"
          read={(snapshot) => snapshot.labelIds}
          disabled={optionDisabled('labels')}
          onToggle={executeAssociation}
          removeOnlyIds={removeOnlyLabelIds}
          onRemove={executeAssociationRemoval}
        />
        <Field label="Anticipated start date">
          <DatePicker
            value={scalarValue(start)}
            onChange={(value) => {
              executeScalar('startDate', value, 'anticipated start date');
            }}
            placeholder={scalarPlaceholder(start, 'Set anticipated start')}
            ariaLabel="Anticipated start date"
            disabled={disabled}
          />
          {start.state === 'mixed' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                executeScalar('startDate', null, 'anticipated start date');
              }}
            >
              Clear anticipated start date for all
            </Button>
          ) : null}
        </Field>
        <Field label="Due date">
          <DatePicker
            value={scalarValue(due)}
            onChange={(value) => {
              executeScalar('dueDate', value, 'due date');
            }}
            placeholder={scalarPlaceholder(due, 'Set due date')}
            ariaLabel="Due date"
            disabled={disabled}
          />
          {due.state === 'mixed' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                executeScalar('dueDate', null, 'due date');
              }}
            >
              Clear due date for all
            </Button>
          ) : null}
        </Field>
        <Field label="Estimate">
          {estimation.loading ? (
            <p className="text-body-small text-on-surface-variant">Loading estimation scale…</p>
          ) : estimation.error != null ? (
            <SourceError
              message={estimation.error}
              retryLabel="Retry estimation settings"
              onRetry={estimation.retry}
            />
          ) : estimation.scale === null || estimation.scale === 'none' ? (
            <p className="text-body-small text-on-surface-variant">
              Estimation is disabled for this workspace.
            </p>
          ) : (
            <>
              {estimate.state === 'mixed' ? (
                <span className="text-body-small text-on-surface-variant">Mixed</span>
              ) : null}
              <EstimatePicker
                scale={estimation.scale}
                value={scalarValue(estimate)}
                onChange={(value) => {
                  executeScalar('estimate', value, 'estimate');
                }}
                disabled={disabled}
              />
            </>
          )}
        </Field>
      </>
    );
  }

  const projects = snapshots.filter(
    (snapshot): snapshot is Extract<CanvasPropertySnapshot, { kind: 'project' }> =>
      snapshot.kind === 'project',
  );
  const status = aggregateScalar(projects, (project) => project.status);
  const health = aggregateScalar(projects, (project) => project.health);
  const priority = aggregateScalar(projects, (project) => project.priority);
  const lead = aggregateScalar(projects, (project) => project.leadId);
  const team = aggregateScalar(projects, (project) => project.teamId);
  const program = aggregateScalar(projects, (project) => project.programId);
  const start = aggregateScalar(projects, (project) => project.startTimeframe, sameTimeframe);
  const target = aggregateScalar(projects, (project) => project.targetTimeframe, sameTimeframe);
  return (
    <>
      {selectionIssue !== null ? (
        <p className="text-body-medium text-error">{selectionIssue}</p>
      ) : null}
      {options.error != null ? (
        <SourceError
          message={options.error}
          retryLabel="Retry property choices"
          onRetry={options.retry}
        />
      ) : null}
      <Field label="Status">
        <EnumPicker
          options={statusOptions(registry.statusesFor('project'))}
          value={scalarValue(status)}
          onChange={(value) => {
            if (value !== null) executeScalar('status', value, 'status');
          }}
          placeholder={scalarPlaceholder(status, 'Set status')}
          ariaLabel="Status"
          disabled={disabled || !registry.loaded || registry.error != null}
        />
        {registry.error != null ? (
          <SourceError
            message={registry.error}
            retryLabel="Retry statuses"
            onRetry={registry.retry}
          />
        ) : null}
      </Field>
      <Field label="Health">
        <EnumPicker
          options={HEALTH_OPTIONS}
          value={scalarValue(health)}
          onChange={(value) => {
            executeScalar('health', value, 'health');
          }}
          placeholder={scalarPlaceholder(health, 'Set health')}
          clearLabel="No health"
          ariaLabel="Health"
          disabled={disabled}
        />
      </Field>
      <Field label="Priority">
        <EnumPicker
          options={PRIORITY_OPTIONS}
          value={scalarValue(priority)}
          onChange={(value) => {
            if (value !== null) executeScalar('priority', value, 'priority');
          }}
          placeholder={scalarPlaceholder(priority, 'Set priority')}
          ariaLabel={priority.state === 'mixed' ? 'Priority — Mixed' : 'Priority'}
          disabled={disabled}
        />
      </Field>
      <Field label="Lead">
        <ActorPicker
          options={options.memberOptions}
          value={scalarValue(lead)}
          onChange={(value) => {
            executeScalar('leadId', value, 'lead');
          }}
          placeholder={scalarPlaceholder(lead, 'Set lead')}
          clearLabel="No lead"
          ariaLabel="Lead"
          disabled={optionDisabled('actors')}
        />
      </Field>
      <Field label="Team">
        <EntityPicker
          options={options.teamOptions}
          value={scalarValue(team)}
          onChange={(value) => {
            executeScalar('teamId', value, 'Team');
          }}
          placeholder={scalarPlaceholder(team, 'Set Team')}
          clearLabel="No Team"
          ariaLabel="Team"
          disabled={optionDisabled('teams')}
        />
      </Field>
      <Field label="Program">
        <EntityPicker
          options={options.programOptions}
          value={scalarValue(program)}
          onChange={(value) => {
            executeScalar('programId', value, 'Program');
          }}
          placeholder={scalarPlaceholder(program, 'Set Program')}
          clearLabel="No Program"
          ariaLabel="Program"
          disabled={optionDisabled('programs')}
        />
      </Field>
      <AssociationField
        label="Initiatives"
        noun="Project"
        snapshots={projects}
        options={options.initiativeOptions}
        association="initiative"
        read={(snapshot) => (snapshot.kind === 'project' ? snapshot.initiativeIds : [])}
        disabled={optionDisabled('initiatives')}
        onToggle={executeAssociation}
        onRemove={executeAssociationRemoval}
      />
      <AssociationField
        label="Labels"
        noun="Project"
        snapshots={projects}
        options={validLabelOptions}
        association="label"
        read={(snapshot) => snapshot.labelIds}
        disabled={optionDisabled('labels')}
        onToggle={executeAssociation}
        removeOnlyIds={removeOnlyLabelIds}
        onRemove={executeAssociationRemoval}
      />
      <Field label="Start timeframe">
        {start.state === 'mixed' ? (
          <span className="text-body-small text-on-surface-variant">Mixed</span>
        ) : null}
        <TimeframePicker
          label="Start timeframe"
          value={scalarValue(start)}
          fiscalYearStartMonth={planning.fiscalYearStartMonth}
          edge="start"
          onChange={(value) => {
            executeScalar('startTimeframe', timeframeCommandValue(value), 'start timeframe');
          }}
          disabled={disabled || planning.loading || planning.error != null}
        />
        {start.state === 'mixed' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || planning.loading || planning.error != null}
            onClick={() => {
              executeScalar('startTimeframe', { date: null, resolution: null }, 'start timeframe');
            }}
          >
            Clear start timeframe for all
          </Button>
        ) : null}
      </Field>
      <Field label="Target timeframe">
        {target.state === 'mixed' ? (
          <span className="text-body-small text-on-surface-variant">Mixed</span>
        ) : null}
        <TimeframePicker
          label="Target timeframe"
          value={scalarValue(target)}
          fiscalYearStartMonth={planning.fiscalYearStartMonth}
          edge="target"
          onChange={(value) => {
            executeScalar('targetTimeframe', timeframeCommandValue(value), 'target timeframe');
          }}
          disabled={disabled || planning.loading || planning.error != null}
        />
        {target.state === 'mixed' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || planning.loading || planning.error != null}
            onClick={() => {
              executeScalar(
                'targetTimeframe',
                { date: null, resolution: null },
                'target timeframe',
              );
            }}
          >
            Clear target timeframe for all
          </Button>
        ) : null}
      </Field>
      {planning.error != null ? (
        <SourceError
          message={planning.error}
          retryLabel="Retry planning settings"
          onRetry={planning.retry}
        />
      ) : null}
    </>
  );
}
