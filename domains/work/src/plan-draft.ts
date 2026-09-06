/**
 * `domain packages` — the plan document reducer.
 *
 * @remarks
 * Every edit to a plan draft, whether Athena's or the person's, goes through {@link applyPlanOps}.
 * The API runs it before writing and the web client runs it for optimistic updates, so both sides
 * agree on every rule: which fields a kind carries, which parent a kind may sit under, that a
 * confirmed node is read-only in the document, and that a batch either applies whole or leaves
 * the document untouched.
 *
 * The reducer is pure. Template payloads arrive through {@link PlanOpEnvironment} so the module
 * needs no I/O of its own.
 */
import type {
  PlanDocument,
  PlanNode,
  PlanNodeFields,
  PlanNodeKind,
  PlanOp,
} from './contracts/plan-draft';
import type { TemplateDraft } from './contracts/template';

/** A plan with nothing in it yet. */
export const EMPTY_PLAN_DOCUMENT: PlanDocument = { nodes: [], edges: [] };

/** A rejected op: which one, which path inside it, and why in plain words. */
export class PlanOpError extends Error {
  constructor(
    readonly index: number,
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'PlanOpError';
  }
}

/** What the reducer needs from outside: the payload behind a template id. */
export interface PlanOpEnvironment {
  /** The template's draft, or undefined when no such template is visible. */
  templatePayload(templateId: string): TemplateDraft | undefined;
}

/** Which parent kinds each kind may sit under. */
const ALLOWED_PARENTS: Readonly<Record<PlanNodeKind, readonly PlanNodeKind[]>> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  task: ['project'],
};

/** Which fields each kind carries. */
const FIELDS_BY_KIND: Readonly<Record<PlanNodeKind, ReadonlySet<keyof PlanNodeFields>>> = {
  initiative: new Set([
    'title',
    'summary',
    'description',
    'status',
    'priority',
    'health',
    'updateCadence',
    'ownerId',
    'labelIds',
    'targetDate',
  ]),
  program: new Set(['title', 'summary', 'description', 'status', 'health', 'ownerId', 'labelIds']),
  project: new Set([
    'title',
    'summary',
    'description',
    'status',
    'priority',
    'health',
    'leadId',
    'teamId',
    'labelIds',
    'startDate',
    'targetDate',
  ]),
  task: new Set([
    'title',
    'description',
    'status',
    'priority',
    'assigneeId',
    'teamId',
    'labelIds',
    'startDate',
    'dueDate',
    'estimate',
  ]),
};

/** The template keys a kind merges, in the order they are copied. */
const TEMPLATE_FIELD_KEYS: Readonly<Record<PlanNodeKind, readonly (keyof PlanNodeFields)[]>> = {
  initiative: ['summary', 'description', 'status', 'priority', 'updateCadence', 'health'],
  program: ['summary', 'description', 'status', 'health'],
  project: ['summary', 'description', 'status', 'health'],
  task: ['description', 'priority', 'labelIds'],
};

/** Find a node by ref. */
export function planNode(document: PlanDocument, ref: string): PlanNode | undefined {
  return document.nodes.find((node) => node.ref === ref);
}

function assertFieldsForKind(
  index: number,
  kind: PlanNodeKind,
  fields: Readonly<Record<string, unknown>>,
): void {
  for (const key of Object.keys(fields) as (keyof PlanNodeFields)[]) {
    if (!FIELDS_BY_KIND[kind].has(key)) {
      throw new PlanOpError(index, `ops.${index}.fields.${key}`, `A ${kind} has no ${key}.`);
    }
  }
}

/** A partial patch with every `undefined` entry dropped, so it cannot erase a required field. */
function definedEntries(patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

/** Reject a parent the kind cannot sit under, an unknown parent, or a cycle. */
function assertParent(
  index: number,
  document: PlanDocument,
  kind: PlanNodeKind,
  parentRef: string | null,
  selfRef: string,
): void {
  const path = `ops.${index}.parentRef`;
  if (parentRef === null) {
    if (kind !== 'initiative') throw new PlanOpError(index, path, `A ${kind} needs a parent.`);
    return;
  }
  if (parentRef === selfRef) throw new PlanOpError(index, path, 'A node cannot be its own parent.');
  const parent = planNode(document, parentRef);
  if (!parent) throw new PlanOpError(index, path, `No node has ref "${parentRef}".`);
  if (!ALLOWED_PARENTS[kind].includes(parent.kind)) {
    throw new PlanOpError(index, path, `A ${kind} cannot sit under a ${parent.kind}.`);
  }
  let cursor: PlanNode | undefined = parent;
  while (cursor) {
    if (cursor.ref === selfRef) throw new PlanOpError(index, path, 'That would make a cycle.');
    cursor = cursor.parentRef === null ? undefined : planNode(document, cursor.parentRef);
  }
}

/** The ref and every descendant ref. */
function subtreeRefs(document: PlanDocument, ref: string): Set<string> {
  const out = new Set([ref]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of document.nodes) {
      if (node.parentRef !== null && out.has(node.parentRef) && !out.has(node.ref)) {
        out.add(node.ref);
        grew = true;
      }
    }
  }
  return out;
}

function requireNode(index: number, document: PlanDocument, ref: string, path: string): PlanNode {
  const node = planNode(document, ref);
  if (!node) throw new PlanOpError(index, path, `No node has ref "${ref}".`);
  return node;
}

function requireDraft(index: number, document: PlanDocument, ref: string, path: string): PlanNode {
  const node = requireNode(index, document, ref, path);
  if (node.status === 'confirmed') {
    throw new PlanOpError(index, path, 'That node is already created; edit it in the workspace.');
  }
  return node;
}

/** Order nodes so every parent precedes its children, keeping source order otherwise. */
function parentsFirst(nodes: readonly PlanNode[]): PlanNode[] {
  const byRef = new Map(nodes.map((node) => [node.ref, node]));
  const ordered: PlanNode[] = [];
  const done = new Set<string>();
  const visit = (node: PlanNode): void => {
    if (done.has(node.ref)) return;
    done.add(node.ref);
    const parent = node.parentRef === null ? undefined : byRef.get(node.parentRef);
    if (parent) visit(parent);
    ordered.push(node);
  };
  for (const node of nodes) visit(node);
  return ordered;
}

/** Reject an upsert that would touch a created node or change a node's kind. */
function assertUpsertAllowed(
  existing: PlanNode | undefined,
  op: Extract<PlanOp, { op: 'upsert_node' }>,
  index: number,
): void {
  if (existing?.status === 'confirmed') {
    throw new PlanOpError(
      index,
      `ops.${index}.node.ref`,
      'That node is already created; edit it in the workspace.',
    );
  }
  if (existing && existing.kind !== op.node.kind) {
    throw new PlanOpError(index, `ops.${index}.node.kind`, 'A node cannot change kind.');
  }
  if (!existing && (op.node.fields.title ?? '').trim().length === 0) {
    throw new PlanOpError(index, `ops.${index}.node.fields.title`, 'A new node needs a title.');
  }
  assertFieldsForKind(index, op.node.kind, op.node.fields);
}

/**
 * The supplied value when the op carried one, else the fallback.
 *
 * @remarks
 * `null` counts as supplied: clearing a parent or a template is a real instruction, which is why
 * this is not `??`.
 */
function supplied<T>(value: T | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  return value;
}

/** The node an upsert produces: supplied keys win, omitted keys keep the existing values. */
function mergeUpsert(
  existing: PlanNode | undefined,
  node: Extract<PlanOp, { op: 'upsert_node' }>['node'],
): PlanNode {
  const base: PlanNode = existing ?? {
    ref: node.ref,
    kind: node.kind,
    parentRef: null,
    initiativeRefs: [],
    initiativeIds: [],
    // A new node always has a title: `assertUpsertAllowed` refused it otherwise.
    fields: { ...node.fields, title: node.fields.title ?? '' },
    templateId: null,
    status: 'draft',
    objectId: null,
  };
  return {
    ref: node.ref,
    kind: node.kind,
    parentRef: supplied(node.parentRef, base.parentRef),
    initiativeRefs: supplied(node.initiativeRefs, base.initiativeRefs),
    initiativeIds: supplied(node.initiativeIds, base.initiativeIds),
    fields: { ...base.fields, ...node.fields, title: node.fields.title ?? base.fields.title },
    templateId: supplied(node.templateId, base.templateId),
    status: 'draft',
    objectId: null,
  };
}

function applyUpsert(
  document: PlanDocument,
  op: Extract<PlanOp, { op: 'upsert_node' }>,
  index: number,
): PlanDocument {
  const existing = planNode(document, op.node.ref);
  assertUpsertAllowed(existing, op, index);
  const next = mergeUpsert(existing, op.node);
  const nodes = existing
    ? document.nodes.map((node) => (node.ref === next.ref ? next : node))
    : [...document.nodes, next];
  return { ...document, nodes };
}

function applyRemove(document: PlanDocument, ref: string, index: number): PlanDocument {
  requireDraft(index, document, ref, `ops.${index}.ref`);
  const gone = subtreeRefs(document, ref);
  for (const member of gone) {
    if (planNode(document, member)?.status === 'confirmed') {
      throw new PlanOpError(index, `ops.${index}.ref`, 'A created node is inside that subtree.');
    }
  }
  return {
    nodes: document.nodes
      .filter((node) => !gone.has(node.ref))
      .map((node) => ({
        ...node,
        initiativeRefs: node.initiativeRefs.filter((candidate) => !gone.has(candidate)),
      })),
    edges: document.edges.filter((edge) => !gone.has(edge.fromRef) && !gone.has(edge.toRef)),
  };
}

function applyAddEdge(
  document: PlanDocument,
  op: Extract<PlanOp, { op: 'add_edge' }>,
  index: number,
): PlanDocument {
  const from = requireNode(index, document, op.fromRef, `ops.${index}.fromRef`);
  const to = requireNode(index, document, op.toRef, `ops.${index}.toRef`);
  const path = `ops.${index}.toRef`;
  if (from.ref === to.ref) throw new PlanOpError(index, path, 'A node cannot block itself.');
  if (from.kind !== to.kind || from.kind === 'initiative' || from.kind === 'program') {
    throw new PlanOpError(index, path, 'Dependencies join two projects or two tasks.');
  }
  if (from.status === 'confirmed' && to.status === 'confirmed') {
    throw new PlanOpError(index, path, 'Both are already created; link them in the workspace.');
  }
  if (document.edges.some((edge) => edge.fromRef === op.fromRef && edge.toRef === op.toRef)) {
    return document;
  }
  return {
    ...document,
    edges: [...document.edges, { fromRef: op.fromRef, toRef: op.toRef, kind: 'blocks' }],
  };
}

function applyTemplate(
  document: PlanDocument,
  op: Extract<PlanOp, { op: 'apply_template' }>,
  index: number,
  env: PlanOpEnvironment,
): PlanDocument {
  const node = requireDraft(index, document, op.ref, `ops.${index}.ref`);
  const payload = env.templatePayload(op.templateId);
  const path = `ops.${index}.templateId`;
  if (!payload) throw new PlanOpError(index, path, 'That template does not exist here.');
  if (payload.targetType !== node.kind) {
    throw new PlanOpError(index, path, `That template creates a ${payload.targetType}.`);
  }
  const fields: Record<string, unknown> = { ...node.fields };
  const source = payload as Readonly<Record<string, unknown>>;
  for (const key of TEMPLATE_FIELD_KEYS[node.kind]) {
    const value = source[key];
    if (value !== undefined && fields[key] === undefined) fields[key] = value;
  }
  return {
    ...document,
    nodes: document.nodes.map((candidate) =>
      candidate.ref === op.ref
        ? { ...candidate, fields: fields as PlanNodeFields, templateId: op.templateId }
        : candidate,
    ),
  };
}

function applyOne(
  document: PlanDocument,
  op: PlanOp,
  index: number,
  env: PlanOpEnvironment,
): PlanDocument {
  switch (op.op) {
    case 'set_title':
      // The title is a column on the plan, applied by the store; the document is unchanged.
      return document;
    case 'upsert_node':
      return applyUpsert(document, op, index);
    case 'set_fields': {
      const node = requireDraft(index, document, op.ref, `ops.${index}.ref`);
      const patch = definedEntries(op.fields);
      assertFieldsForKind(index, node.kind, patch);
      const fields = { ...node.fields, ...patch };
      if (fields.title.trim().length === 0) {
        throw new PlanOpError(index, `ops.${index}.fields.title`, 'A title is required.');
      }
      return {
        ...document,
        nodes: document.nodes.map((candidate) =>
          candidate.ref === op.ref ? { ...candidate, fields } : candidate,
        ),
      };
    }
    case 'move_node': {
      requireDraft(index, document, op.ref, `ops.${index}.ref`);
      return {
        ...document,
        nodes: document.nodes.map((candidate) =>
          candidate.ref === op.ref ? { ...candidate, parentRef: op.parentRef } : candidate,
        ),
      };
    }
    case 'remove_node':
      return applyRemove(document, op.ref, index);
    case 'add_edge':
      return applyAddEdge(document, op, index);
    case 'remove_edge':
      return {
        ...document,
        edges: document.edges.filter(
          (edge) => !(edge.fromRef === op.fromRef && edge.toRef === op.toRef),
        ),
      };
    case 'apply_template':
      return applyTemplate(document, op, index, env);
  }
}

/**
 * Apply a batch of ops atomically.
 *
 * @remarks
 * Parent rules are checked once the whole batch has applied, so a tree may arrive in any order —
 * a task before the project it names, the project before its initiative. A rejection names the
 * op that placed or moved the offending node.
 *
 * @param document - The current document; never mutated.
 * @param ops - The batch, applied in order.
 * @param env - Where template payloads come from.
 * @returns the next document, nodes parents-first.
 * @throws {PlanOpError} When any op is invalid; the input document is unchanged.
 */
export function applyPlanOps(
  document: PlanDocument,
  ops: readonly PlanOp[],
  env: PlanOpEnvironment,
): PlanDocument {
  let next = document;
  const placedBy = new Map<string, number>();
  ops.forEach((op, index) => {
    next = applyOne(next, op, index, env);
    if (op.op === 'upsert_node') placedBy.set(op.node.ref, index);
    if (op.op === 'move_node') placedBy.set(op.ref, index);
  });
  for (const node of next.nodes) {
    const index = placedBy.get(node.ref);
    if (index === undefined) continue;
    assertParent(index, next, node.kind, node.parentRef, node.ref);
  }
  return { ...next, nodes: parentsFirst(next.nodes) };
}

/**
 * The refs plus every unconfirmed ancestor, parents first.
 *
 * @remarks
 * This is the set a commit creates: a task never lands without its project and a project never
 * lands without its initiative. Already-confirmed nodes and unknown refs are left out.
 */
export function planNodeClosure(document: PlanDocument, refs: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const ref of refs) {
    let cursor = planNode(document, ref);
    while (cursor && cursor.status !== 'confirmed') {
      wanted.add(cursor.ref);
      cursor = cursor.parentRef === null ? undefined : planNode(document, cursor.parentRef);
    }
  }
  return parentsFirst(document.nodes)
    .filter((node) => wanted.has(node.ref))
    .map((node) => node.ref);
}

/** The counts the app bar shows. */
export function planCounts(document: PlanDocument): {
  projects: number;
  tasks: number;
  draft: number;
} {
  return {
    projects: document.nodes.filter((node) => node.kind === 'project').length,
    tasks: document.nodes.filter((node) => node.kind === 'task').length,
    draft: document.nodes.filter((node) => node.status === 'draft').length,
  };
}
