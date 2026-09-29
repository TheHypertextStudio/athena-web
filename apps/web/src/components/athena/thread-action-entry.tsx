'use client';

/** A saved Athena action, including its outcome and optional call details. */
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import { parseMcpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { RelativeTime } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { relativeTime } from '@docket/ui';
import type { JSX } from 'react';

import { PLAN_TOOL_NAMES } from '@docket/work/plan-draft-contract';

import { JobStepDetails } from '@/components/athena/job-card-steps';
import { McpAppPresentationCard } from '@/components/athena/mcp-app-presentation-card';
import { parsePlanStart } from '@/components/plan-canvas/plan-start-card';
import { capitalizeFirst } from '@/lib/athena/describe-proposal';
import { adaptAthenaActivity } from '@/lib/athena/api-adapter';
import { presentAthenaActivity } from '@/lib/athena/presentation';

import { ThreadPlanEntry } from './thread-plan-entry';

/** Props for a saved action inside the conversation. */
export interface ThreadActionEntryProps {
  readonly activity: SessionActivityOut;
  readonly onWidgetMessage: (text: string) => Promise<boolean>;
}

/** Read one object from a stored, untrusted action body. */
function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** The concise lifecycle label supported by the recorded action state. */
function actionState(
  activity: SessionActivityOut,
  action: Readonly<Record<string, unknown>> | null,
  result: Readonly<Record<string, unknown>> | null,
): string {
  if (activity.approvalStatus === 'failed' || result?.['isError'] === true) return 'Failed';
  if (activity.approvalStatus === 'rejected') return 'Declined';
  if (activity.approvalStatus === 'applied') return 'Done';
  if (activity.approvalStatus === 'approved') return 'Applying';
  if (activity.approvalStatus === 'proposed' || action?.['mode'] === 'proposal') {
    return 'Needs review';
  }
  if (result) return 'Done';
  return 'Recorded';
}

/** The selected runtime when this action records a sealed Lattice return. */
function latticeReturn(body: Readonly<Record<string, unknown>>): string | null {
  const lattice = record(body['lattice']);
  if (lattice?.['outcome'] !== 'completed') return null;
  const name = lattice['runtimeName'];
  return typeof name === 'string' && name.trim()
    ? `Returned from ${name.trim()}`
    : 'Returned from Lattice';
}

/** The tool label is separate from the action summary so a person can identify the actual call. */
function toolLabel(service: string, name: string | undefined): string {
  return name ? `${service} · ${name}` : service;
}

/** A stored action's safe, human-readable summary. */
function actionSummary(action: Readonly<Record<string, unknown>> | null): string {
  const summary = action?.['summary'];
  return typeof summary === 'string' && summary.trim()
    ? capitalizeFirst(summary.trim())
    : 'Athena action';
}

/** Label the recorded tool call without requiring every historical action to have one. */
function actionToolLabel(adapted: ReturnType<typeof adaptAthenaActivity>): string {
  if (adapted?.type !== 'tool') return 'Docket';
  return toolLabel(adapted.service, adapted.technical?.toolName);
}

/** The plan a successful plan-start call created. */
function startedPlan(
  action: Readonly<Record<string, unknown>> | null,
  result: Readonly<Record<string, unknown>> | null,
): ReturnType<typeof parsePlanStart> {
  if (action?.['kind'] !== PLAN_TOOL_NAMES.start || result?.['isError'] === true) return null;
  return parsePlanStart(result?.['content']);
}

/** Props for the visible, compact record of an action. */
interface ActionLineProps {
  readonly activity: SessionActivityOut;
  readonly action: Readonly<Record<string, unknown>> | null;
  readonly result: Readonly<Record<string, unknown>> | null;
}

/** Show the action's saved state, tool identity, time, summary, and disclosed inputs. */
function ActionLine({ activity, action, result }: ActionLineProps): JSX.Element {
  const adapted = adaptAthenaActivity(activity);
  const presented = adapted ? presentAthenaActivity(adapted) : null;
  const state = actionState(activity, action, result);
  const runtime = latticeReturn(activity.body);
  const summary = actionSummary(action);

  return (
    <div
      className={cn(
        'rounded-corner-md relative flex flex-col gap-1 py-2 pr-3 pl-8',
        surfaceToneColor('floating'),
      )}
    >
      <span
        aria-hidden="true"
        className={`absolute top-3 left-3 size-2.5 rounded-full ${state === 'Failed' ? 'bg-error' : 'bg-primary'}`}
      />
      <div className="text-label-small flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-on-surface">{state}</span>
        <span className="text-on-surface-variant">{actionToolLabel(adapted)}</span>
        <RelativeTime iso={activity.createdAt} className="text-on-surface-variant">
          {relativeTime(activity.createdAt)}
        </RelativeTime>
      </div>
      <p className="text-on-surface text-body-small break-words">{summary}</p>
      {runtime ? <p className="text-on-surface-variant text-body-small">{runtime}</p> : null}
      {presented?.technical ? <JobStepDetails entry={presented} /> : null}
    </div>
  );
}

/** Props for durable output cards captured by an action. */
interface ActionArtifactsProps {
  readonly activityId: string;
  readonly action: Readonly<Record<string, unknown>> | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly onWidgetMessage: ThreadActionEntryProps['onWidgetMessage'];
}

/** Keep plan and MCP app cards connected to the action that created them. */
function ActionArtifacts({
  activityId,
  action,
  result,
  onWidgetMessage,
}: ActionArtifactsProps): JSX.Element {
  const presentation = parseMcpAppPresentation(result?.['presentation']);
  const presentationUnavailable =
    result?.['presentationUnavailable'] === true ||
    (result?.['presentation'] !== undefined && !presentation);
  const plan = startedPlan(action, result);
  return (
    <>
      {plan ? <ThreadPlanEntry plan={plan} /> : null}
      {presentation ? (
        <McpAppPresentationCard
          presentation={presentation}
          activityId={activityId}
          onMessage={onWidgetMessage}
        />
      ) : null}
      {presentationUnavailable ? (
        <p className="text-on-surface-variant text-body-small" data-testid="mcp-app-view-failure">
          Interactive view unavailable.
        </p>
      ) : null}
    </>
  );
}

/** Render one honest action record and the durable artifacts it created. */
export function ThreadActionEntry({
  activity,
  onWidgetMessage,
}: ThreadActionEntryProps): JSX.Element {
  const action = record(activity.body['action']);
  const result = record(action?.['result']);
  return (
    <div className="flex w-full flex-col gap-2" data-slot="athena-action">
      <ActionLine activity={activity} action={action} result={result} />
      <ActionArtifacts
        activityId={activity.id}
        action={action}
        result={result}
        onWidgetMessage={onWidgetMessage}
      />
    </div>
  );
}
