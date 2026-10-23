/** Graph validation shared by immutable process publication and revision authoring. */
import { ProcessDefinitionCreate, type ProcessStepTiming } from '../../contracts/recurrence';
import { CycleError } from '../../error';

interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

function timingEdge(stepKey: string, timing: ProcessStepTiming): GraphEdge | null {
  return timing.kind === 'after_step_completion' ? { from: timing.stepKey, to: stepKey } : null;
}

function definitionEdges(parsed: ProcessDefinitionCreate): GraphEdge[] {
  const edges: GraphEdge[] = parsed.dependencies.map((edge) => ({
    from: edge.blockingStepKey,
    to: edge.blockedStepKey,
  }));
  for (const step of [
    ...(parsed.project ? [parsed.project] : []),
    ...parsed.milestones,
    ...parsed.tasks,
  ]) {
    const edge = timingEdge(step.key, step.timing);
    if (edge) edges.push(edge);
  }
  for (const step of parsed.tasks) {
    if (step.parentTaskKey) edges.push({ from: step.parentTaskKey, to: step.key });
  }
  return edges;
}

function assertAcyclic(keys: string[], edges: GraphEdge[]): void {
  const outgoing = new Map(keys.map((key) => [key, [] as string[]]));
  const incoming = new Map(keys.map((key) => [key, 0]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const ready = keys.filter((key) => incoming.get(key) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const key = ready.shift();
    if (key === undefined) break;
    visited += 1;
    for (const dependent of outgoing.get(key) ?? []) {
      const remaining = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  if (visited !== keys.length) throw new CycleError('Process graph contains a dependency cycle');
}

/**
 * Reject cycles across task dependencies, completion timing, and parent-task hierarchy.
 * @param definition - Parsed process definition to inspect.
 * @throws {CycleError} When no topological execution order exists.
 */
export function validateProcessDefinitionGraph(definition: ProcessDefinitionCreate): void {
  const parsed = ProcessDefinitionCreate.parse(definition);
  const keys = [
    ...(parsed.project ? [parsed.project.key] : []),
    ...parsed.milestones.map((step) => step.key),
    ...parsed.tasks.map((step) => step.key),
  ];
  assertAcyclic(keys, definitionEdges(parsed));
}
