import { genId } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import type { BlueprintCreationContext, PlannedWorkTree } from '@docket/work/blueprints';
import {
  BlueprintCreationOptions,
  BlueprintPreviewOptions,
} from '@docket/work/work-template-blueprint';
import { ConflictError } from '../../error';
import { authorizeOrdinaryCreation } from '../work-creation/context';
import { prospectiveWorkReference } from '../work-creation/ordinary-prospective';
import { prepareOrdinaryWork } from '../work-creation/ordinary-prepare';
import type {
  OrdinaryWorkCommand,
  OrdinaryPreparationContext,
  PreparedOrdinaryWork,
} from '../work-creation/types';
import type { ResolvedWorkInsert, InsertedWork } from '../work-creation/writers';
import type { TemplateTransaction } from '../templates/persistence';
import { requireWorkAccess } from '../work-template-selection';
import { loadBlueprintCreationContext, type AuthorizedBlueprintCreationContext } from './context';
import { blueprintFingerprint } from './fingerprint';
import { allocateBlueprintPlacement, type AllocatedBlueprintNode } from './placement';
import { preparedBlueprintRoot } from './root';
import { prepareBlueprintEntries } from './preflight-entries';
import { prepareGenerationMetadata } from './generation';
import { retainedRootBinding } from '../work-creation/retained-authority';
import { loadRetainedBlueprintRoot, type RetainedBlueprintRoot } from './retained';
import {
  loadRetainedBlueprintResolutionProof,
  loadScheduleBlueprintResolutionProof,
} from './resolution-retained';
import { planScheduleBlueprint } from '../recurrence/schedule-compiler';
import { assertSchedulePlanBinding } from '../recurrence/schedule-authority';
import {
  validateSchedulePlacement,
  applyScheduleRootClears,
} from '../recurrence/schedule-placement';
import { resolveBlueprintLabelDefaults } from './labels';
import {
  readBlueprintClosure,
  resolveBlueprintClosure,
  type ResolvedBlueprintClosure,
} from './resolve';

/** A trusted enclosing forest delays definition locks until its full sorted closure is known. */
export interface BlueprintPreparationOptions {
  readonly deferTemplateLocks?: boolean;
}

/** Fully authorized, parent-ordered inserts; no work has been written yet. */
export interface PreparedBlueprintCreation {
  readonly command: OrdinaryWorkCommand;
  readonly graph: ResolvedBlueprintClosure;
  readonly tree: PlannedWorkTree;
  readonly context: BlueprintCreationContext;
  readonly previewToken: string;
  readonly entries: readonly PreparedBlueprintEntry[];
  readonly rowCount: number;
}
/** Prepared ordinary work or a Project checkpoint with identical immutable origin columns. */
export type PreparedBlueprintEntry =
  | {
      readonly kind: 'existing';
      readonly allocated: AllocatedBlueprintNode;
      readonly work: InsertedWork;
    }
  | {
      readonly kind: 'ordinary';
      readonly allocated: AllocatedBlueprintNode;
      readonly prepared: PreparedOrdinaryWork;
    }
  | {
      readonly kind: 'milestone';
      readonly allocated: AllocatedBlueprintNode;
      readonly insert: Extract<ResolvedWorkInsert, { kind: 'milestone' }>;
    };

function selectedCommand(
  command: OrdinaryWorkCommand,
  graph: ResolvedBlueprintClosure,
): OrdinaryWorkCommand {
  const identity = { workTypeId: graph.root.workTypeId, workTypeVersionId: graph.root.versionId };
  switch (command.kind) {
    case 'task':
      return { ...command, body: { ...command.body, ...identity } };
    case 'project':
      return { ...command, body: { ...command.body, ...identity } };
    case 'initiative':
      return { ...command, body: { ...command.body, ...identity } };
    case 'program':
      return { ...command, body: { ...command.body, ...identity } };
  }
}
/** Resolve defaults, choices, references, permissions and actual row budget before the first insert. */
export async function prepareBlueprintCreation(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  preparationContext?: OrdinaryPreparationContext,
  preparationOptions: BlueprintPreparationOptions = {},
): Promise<PreparedBlueprintCreation> {
  return prepareCreation(tx, command, preparationContext, preparationOptions);
}

/** Read-only review facts; the insert capability never escapes the creation preflight. */
export type ReviewedBlueprintCreation = Omit<PreparedBlueprintCreation, 'command' | 'entries'>;

/** Run the identical authorization and row-budget checks without exposing prepared writes. */
export async function reviewBlueprintCreation(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  options: BlueprintPreviewOptions,
): Promise<ReviewedBlueprintCreation> {
  const { graph, tree, context, previewToken, rowCount } = await prepareCreation(
    tx,
    command,
    undefined,
    { deferTemplateLocks: true },
    BlueprintPreviewOptions.parse(options),
  );
  return { graph, tree, context, previewToken, rowCount };
}

async function prepareCreation(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  preparationContext: OrdinaryPreparationContext | undefined,
  preparationOptions: BlueprintPreparationOptions,
  reviewOptions?: BlueprintPreviewOptions,
): Promise<PreparedBlueprintCreation> {
  const { selected, root, graph, context, options, tree, previewToken, retained } =
    await resolveCreationPlan(tx, command, preparationContext, preparationOptions, reviewOptions);
  const ids = new Map(
    tree.nodes.map((node) => [
      JSON.stringify(node.path),
      retained?.idsByPath.get(JSON.stringify(node.path)) ??
        (node.parentPath === null ? (command.invocation.prospectiveWorkId ?? genId()) : genId()),
    ]),
  );
  const allocated = allocateBlueprintPlacement(tree.nodes, ids, retainedPlacements(retained));
  const visibility = context.visibility;
  const entries = await prepareBlueprintEntries(tx, {
    selected,
    root,
    allocated,
    visibility,
    preparationContext,
    existing: retained?.existingByPath,
  });
  const rowCount = entries.reduce(
    (count, entry) =>
      count +
      (entry.kind === 'existing' ? 0 : 1) +
      (entry.kind === 'ordinary' ? entry.prepared.milestones.length : 0),
    0,
  );
  if (rowCount > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 500 work rows including checkpoints.',
    );
  await prepareGenerationMetadata(tx, entries, {
    tree,
    context,
    options,
    generationKey: allocated[0]?.id,
  });
  return { command: selected, graph, tree, context, previewToken, entries, rowCount };
}

interface CreationPlan {
  readonly selected: OrdinaryWorkCommand;
  readonly root: PreparedOrdinaryWork | null;
  readonly retained: RetainedBlueprintRoot | undefined;
  readonly graph: ResolvedBlueprintClosure;
  readonly context: AuthorizedBlueprintCreationContext;
  readonly options: BlueprintCreationOptions;
  readonly tree: PlannedWorkTree;
  readonly previewToken: string;
}

async function resolveCreationPlan(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  preparationContext: OrdinaryPreparationContext | undefined,
  preparationOptions: BlueprintPreparationOptions,
  reviewOptions?: BlueprintPreviewOptions,
): Promise<CreationPlan> {
  if (reviewOptions) command = { ...command, blueprint: reviewOptions };
  await authorizeOrdinaryCreation(tx, command);
  const { binding, retained, resolutionProof } = await retainedPreparation(tx, command);
  const readClosure = preparationOptions.deferTemplateLocks
    ? readBlueprintClosure
    : resolveBlueprintClosure;
  const graph = await readClosure(
    tx,
    {
      organizationId: command.caller.orgId,
      kind: command.kind,
      workTypeId: command.body.workTypeId,
      workTypeVersionId: command.body.workTypeVersionId,
    },
    binding || resolutionProof ? 'retained_schedule' : 'create',
    undefined,
    resolutionProof,
  );
  const selected = selectedCommand(command, graph);
  const { root, rootDraft, context } = await resolveCreationRoot(tx, {
    selected,
    retained,
    binding,
    preparationContext,
  });
  const options = creationOptions(command, reviewOptions);
  const planned = planScheduleBlueprint(command, {
    graph,
    root: rootDraft,
    context,
    choices: options.optionalChoices,
  });
  assertSchedulePlanBinding(tx, command, planned.tree);
  const tree = await resolveBlueprintLabelDefaults(tx, selected.caller.orgId, planned.tree);
  if (tree.nodes.length + (root?.milestones.length ?? 0) > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 500 work rows including checkpoints.',
    );
  const previewToken = blueprintFingerprint({
    graph: graph.fingerprint,
    root: rootDraft,
    body: previewBody(selected),
    context,
    choices: options.optionalChoices,
    tree,
  });
  if (!reviewOptions && options.previewToken && options.previewToken !== previewToken)
    throw new ConflictError('The creation preview changed.', 'blueprint_preview_stale');
  return { selected, root, graph, context: planned.context, options, tree, previewToken, retained };
}

async function retainedPreparation(tx: TemplateTransaction, command: OrdinaryWorkCommand) {
  const binding = retainedRootBinding(tx, command);
  const resolutionProof = command.invocation.retainedBinding
    ? await loadRetainedBlueprintResolutionProof(tx, command.invocation.retainedBinding)
    : loadScheduleBlueprintResolutionProof(tx, command);
  const retained =
    binding && command.invocation.retainedBinding
      ? await loadRetainedBlueprintRoot(tx, command.invocation.retainedBinding)
      : undefined;
  return { binding, retained, resolutionProof };
}

async function resolveCreationRoot(
  tx: TemplateTransaction,
  input: {
    selected: OrdinaryWorkCommand;
    retained: RetainedBlueprintRoot | undefined;
    binding: ReturnType<typeof retainedRootBinding>;
    preparationContext: OrdinaryPreparationContext | undefined;
  },
) {
  const { selected, retained, binding, preparationContext } = input;
  await validateSchedulePlacement(tx, selected);
  const root = retained?.root ? null : await prepareOrdinaryWork(tx, selected, preparationContext);
  if (root) {
    applyScheduleRootClears(selected, root);
    await authorizeRootAssociations(tx, root, preparationContext);
  }
  const rootDraft = retained?.root ?? preparedBlueprintRoot(requirePreparedRoot(root));
  const loadedContext = retained?.context
    ? { ...retained.context, visibility: retained.visibility }
    : await loadBlueprintCreationContext(tx, selected, rootDraft, undefined, preparationContext);
  const context = retainedContext(loadedContext, retained, binding);
  if (
    context.visibility === 'private' &&
    root &&
    root.insert.kind !== 'initiative' &&
    root.insert.kind !== 'milestone'
  )
    root.insert.values.visibility = 'private';
  return { root, rootDraft, context };
}

function requirePreparedRoot(root: PreparedOrdinaryWork | null): PreparedOrdinaryWork {
  if (!root)
    throw new BlueprintError('blueprint_invalid', 'A new root requires prepared ordinary fields.');
  return root;
}

function retainedPlacements(retained: RetainedBlueprintRoot | undefined) {
  return new Map(
    [...(retained?.existingByPath ?? [])].map(([key, entry]) => [
      key,
      { placement: entry.actualPlacement, visibility: entry.visibility },
    ]),
  );
}

function retainedContext(
  context: AuthorizedBlueprintCreationContext,
  retained: RetainedBlueprintRoot | undefined,
  binding: ReturnType<typeof retainedRootBinding>,
): AuthorizedBlueprintCreationContext {
  if (!retained || !binding) return context;
  return {
    ...context,
    runDate: binding.runDate,
    timezone: binding.occurrence.scheduleTimezone ?? context.timezone,
    visibility: retained.root ? retained.visibility : context.visibility,
    overrides: retained.overrides,
    existingNodes: [...retained.existingByPath.values()].map((entry) => entry.snapshot),
  };
}

function creationOptions(
  command: OrdinaryWorkCommand,
  reviewOptions: BlueprintPreviewOptions | undefined,
): BlueprintPreviewOptions {
  if (reviewOptions) return reviewOptions;
  const options = command.blueprint ?? command.body.blueprint ?? {};
  // Server-authored private schedules re-preflight choices at each run date. Public creation's
  // one-off preview token is not their authority; persisted claims and live checks still apply.
  return command.invocation.scheduleContext
    ? BlueprintPreviewOptions.parse(options)
    : BlueprintCreationOptions.parse(options);
}

function previewBody(command: OrdinaryWorkCommand): Omit<OrdinaryWorkCommand['body'], 'blueprint'> {
  const { blueprint: _blueprint, ...body } = command.body;
  return body;
}

async function authorizeRootAssociations(
  tx: TemplateTransaction,
  root: PreparedOrdinaryWork,
  prospectiveContext: OrdinaryPreparationContext | undefined,
): Promise<void> {
  if (root.command.caller.actorId === null) return;
  for (const id of root.initiativeIds) {
    if (prospectiveWorkReference(tx, root.command, prospectiveContext, 'initiative', id)) continue;
    await requireWorkAccess(tx, root.command.caller, 'initiative', id);
  }
}
