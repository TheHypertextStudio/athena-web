# Athena Planning Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person plans an initiative, its projects, and their tasks by talking to Athena while a durable draft fills in on the graph canvas, and confirms parts of it into real objects.

**Architecture:** A personal `plan_draft` row holds one `PlanDocument` that a pure, shared reducer edits. Athena reaches it through four catalog tools (two ungated by a first-party private-draft annotation), the person reaches it through owner-only `/v1/me/plans` routes and the plan canvas route, and commit reuses the organize tool's placement in one serializable transaction.

**Tech Stack:** Hono + Zod + Drizzle (API), MCP SDK catalog (tools), Next.js App Router + TanStack Query + `@xyflow/react` + dagre (web), Vitest + Testing Library (tests), Playwright (e2e).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-athena-planning-canvas-design.md`. Every decision there is binding.
- Commit types: `feat`, `fix`, `chore` only. Scope `athena` for Athena-side work, `web` for canvas UI, `api` for routes, `mcp` for catalog tools. Body ≥ 100 characters. Trailer exactly `Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>`.
- Staging chain is always `git restore --staged . && git add <paths> && git commit -F <file>`.
- No `TODO`, no stubs, no skipped tests, no new `complexity-debt.json` entries.
- UI copy is application-owned; never render Problem `title`/`detail` or exception text.
- All reads and writes in the web app go through `apps/web/src/lib/query.ts` helpers.
- Tests live under `tests/`, never colocated in `src/`. No `getByText('exact copy')` assertions.
- Use `pnpm exec` / `pnpm dlx`, never `npx`.
- Icons come from `@docket/ui/icons` (Lucide re-exports); shared UI from `@docket/ui/primitives` and `@docket/ui/components`.
- Reduced motion: every animation is disabled under `prefers-reduced-motion`.

---

## File map

| Path                                                                                          | Responsibility                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domains/work/src/contracts/plan-draft.ts`                                                    | Zod contracts: `PlanDocument`, `PlanNode`, `PlanEdge`, `PlanNodeFields`, `PlanOp`, `PlanDraftOut`, `PlanDraftCreate`, `PlanDraftPatch`, `PlanCommitBody`, `PlanCommitOut`, `PLAN_TOOL_NAMES`. |
| `domains/work/src/plan-draft.ts`                                                              | Pure reducer `applyPlanOps`, `PlanOpError`, `planNodeClosure`, `planCounts`, `planNode`.                                                                                                      |
| `domains/work/tests/plan-draft.test.ts`                                                       | Reducer tests.                                                                                                                                                                                |
| `packages/db/src/schema/crosscutting.ts`                                                      | `planDraft` table after `template`.                                                                                                                                                           |
| `packages/db/drizzle/0125_plan_draft.sql`                                                     | Migration.                                                                                                                                                                                    |
| `apps/api/src/lib/plan-draft/store.ts`                                                        | Load/create/patch/archive with revision precondition; hydration of confirmed nodes; template lookup.                                                                                          |
| `apps/api/src/lib/plan-draft/commit.ts`                                                       | `commitPlanNodes`.                                                                                                                                                                            |
| `apps/api/src/lib/organize/place.ts`                                                          | `inParentOrder`, `resolveItem`, `placeItem`, `Placed`, `Placement`, `PlaceInput`, `OrganizeItem` moved out of `organize-tool.ts`.                                                             |
| `apps/api/src/routes/me-plans.ts`                                                             | `/v1/me/plans` router.                                                                                                                                                                        |
| `apps/api/src/mcp/plan-draft-tools.ts`                                                        | `plan_start`, `plan_read`, `plan_draft`, `plan_commit`.                                                                                                                                       |
| `apps/api/src/agent/approval-policy.ts`                                                       | `privateDraft` classification.                                                                                                                                                                |
| `apps/api/src/agent/toolbox.ts`                                                               | Capture `_meta['docket/approval']`; accept `sessionId`.                                                                                                                                       |
| `apps/api/src/agent/system-prompt.ts`                                                         | Planning guidance and active-plan context.                                                                                                                                                    |
| `apps/api/src/agent/loop.ts`                                                                  | Pass session id to the toolbox; load the active plan for the prompt.                                                                                                                          |
| `apps/web/src/lib/plan-draft/defs.ts`                                                         | Query defs, keys, mutations, live hook.                                                                                                                                                       |
| `apps/web/src/components/plan-canvas/plan-nodes.ts`                                           | Document → xyflow nodes/edges projection.                                                                                                                                                     |
| `apps/web/src/components/plan-canvas/plan-layout.ts`                                          | Container layout for project groups plus initiative column.                                                                                                                                   |
| `apps/web/src/components/plan-canvas/plan-diff.ts`                                            | Revision diff for motion.                                                                                                                                                                     |
| `apps/web/src/components/plan-canvas/plan-initiative-node.tsx`                                | Initiative card.                                                                                                                                                                              |
| `apps/web/src/components/plan-canvas/plan-project-node.tsx`                                   | Project container header.                                                                                                                                                                     |
| `apps/web/src/components/plan-canvas/plan-task-node.tsx`                                      | Task row inside a container.                                                                                                                                                                  |
| `apps/web/src/components/plan-canvas/plan-inspector.tsx`                                      | Draft editor and confirmed peek.                                                                                                                                                              |
| `apps/web/src/components/plan-canvas/plan-canvas-panel.tsx`                                   | Host: canvas, chrome, selection bar, confirm, notices, live updates.                                                                                                                          |
| `apps/web/src/components/plan-canvas/plan-start-card.tsx`                                     | The thread card for `plan_start`.                                                                                                                                                             |
| `apps/web/src/app/(app)/orgs/[orgId]/plans/[planId]/page.tsx` + `plan-client.tsx`             | Route.                                                                                                                                                                                        |
| `apps/web/src/lib/offline-routes.generated.ts`                                                | Regenerated.                                                                                                                                                                                  |
| `apps/web/src/components/athena/athena-conversation.tsx`                                      | Render `PlanStartCard` for `plan_start` actions.                                                                                                                                              |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx` | Plan with Athena action.                                                                                                                                                                      |
| `docs/engineering/specs/planning-canvas.md`                                                   | Engineering spec.                                                                                                                                                                             |
| `docs/engineering/specs/mcp-surface.md`                                                       | Document the `docket/approval` annotation.                                                                                                                                                    |

---

### Task 1: Plan document contract and reducer

**Files:**

- Create: `domains/work/src/contracts/plan-draft.ts`
- Create: `domains/work/src/plan-draft.ts`
- Modify: `domains/work/package.json` (exports `./plan-draft-contract`, `./plan-draft`)
- Test: `domains/work/tests/plan-draft.test.ts`

**Interfaces:**

- Produces: `PlanDocument`, `PlanNode`, `PlanNodeFields`, `PlanOp`, `PlanOpError`, `applyPlanOps(document, ops, env)`, `planNodeClosure(document, refs)`, `planCounts(document)`, `PLAN_TOOL_NAMES`.

- [ ] **Step 1: Write the failing reducer tests**

```ts
// domains/work/tests/plan-draft.test.ts
import { describe, expect, it } from 'vitest';
import {
  applyPlanOps,
  PlanOpError,
  planNodeClosure,
  planCounts,
  EMPTY_PLAN_DOCUMENT,
} from '../src/plan-draft';

const env = { templatePayload: () => undefined };

function seeded() {
  return applyPlanOps(
    EMPTY_PLAN_DOCUMENT,
    [
      {
        op: 'upsert_node',
        node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring campaign' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'Outreach' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'Segment donors' } },
      },
    ],
    env,
  );
}

describe('applyPlanOps', () => {
  it('upserts nodes parents-first regardless of op order', () => {
    const doc = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [
        {
          op: 'upsert_node',
          node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'T' } },
        },
        {
          op: 'upsert_node',
          node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'P' } },
        },
        { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'I' } } },
      ],
      env,
    );
    expect(doc.nodes.map((n) => n.ref)).toEqual(['init', 'p1', 't1']);
  });
  it('rejects a task under an initiative', () => {
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [
          { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'I' } } },
          {
            op: 'upsert_node',
            node: { ref: 't', kind: 'task', parentRef: 'init', fields: { title: 'T' } },
          },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
  });
  it('is atomic: a failing op leaves the document untouched', () => {
    const doc = seeded();
    expect(() =>
      applyPlanOps(
        doc,
        [
          { op: 'set_fields', ref: 'p1', fields: { summary: 'ok' } },
          { op: 'set_fields', ref: 'missing', fields: { summary: 'x' } },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
    expect(doc.nodes.find((n) => n.ref === 'p1')?.fields.summary).toBeUndefined();
  });
  it('merges a template without overwriting set fields', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        { op: 'set_fields', ref: 'p1', fields: { description: 'mine' } },
        { op: 'apply_template', ref: 'p1', templateId: 'tpl_1' },
      ],
      {
        templatePayload: () => ({
          targetType: 'project',
          description: 'theirs',
          summary: 'from template',
        }),
      },
    );
    const p1 = doc.nodes.find((n) => n.ref === 'p1');
    expect(p1?.fields.description).toBe('mine');
    expect(p1?.fields.summary).toBe('from template');
    expect(p1?.templateId).toBe('tpl_1');
  });
  it('rejects field edits and moves on a confirmed node', () => {
    const doc = {
      ...seeded(),
      nodes: seeded().nodes.map((n) =>
        n.ref === 'p1' ? { ...n, status: 'confirmed' as const, objectId: 'prj_1' } : n,
      ),
    };
    expect(() =>
      applyPlanOps(doc, [{ op: 'set_fields', ref: 'p1', fields: { summary: 'x' } }], env),
    ).toThrow(PlanOpError);
    expect(() => applyPlanOps(doc, [{ op: 'remove_node', ref: 'p1' }], env)).toThrow(PlanOpError);
  });
  it('allows an edge from a confirmed node to a draft neighbour', () => {
    const base = seeded();
    const withP2 = applyPlanOps(
      base,
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'Push' } },
        },
      ],
      env,
    );
    const doc = {
      ...withP2,
      nodes: withP2.nodes.map((n) =>
        n.ref === 'p1' ? { ...n, status: 'confirmed' as const, objectId: 'prj_1' } : n,
      ),
    };
    const next = applyPlanOps(doc, [{ op: 'add_edge', fromRef: 'p1', toRef: 'p2' }], env);
    expect(next.edges).toEqual([{ fromRef: 'p1', toRef: 'p2', kind: 'blocks' }]);
  });
  it('rejects an edge between different kinds and a self edge', () => {
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'p1', toRef: 't1' }], env),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'p1', toRef: 'p1' }], env),
    ).toThrow(PlanOpError);
  });
  it('removing a node removes its subtree and its edges', () => {
    const doc = applyPlanOps(seeded(), [{ op: 'remove_node', ref: 'p1' }], env);
    expect(doc.nodes.map((n) => n.ref)).toEqual(['init']);
  });
  it('moves a task between projects and rejects moving under a task', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'P2' } },
        },
        { op: 'move_node', ref: 't1', parentRef: 'p2' },
      ],
      env,
    );
    expect(doc.nodes.find((n) => n.ref === 't1')?.parentRef).toBe('p2');
    expect(() => applyPlanOps(doc, [{ op: 'move_node', ref: 'p2', parentRef: 't1' }], env)).toThrow(
      PlanOpError,
    );
  });
  it('rejects fields a kind does not carry', () => {
    expect(() =>
      applyPlanOps(
        seeded(),
        [{ op: 'set_fields', ref: 'init', fields: { dueDate: '2026-05-01' } }],
        env,
      ),
    ).toThrow(PlanOpError);
  });
});

describe('planNodeClosure', () => {
  it('adds unconfirmed ancestors parents-first', () => {
    expect(planNodeClosure(seeded(), ['t1'])).toEqual(['init', 'p1', 't1']);
  });
  it('skips confirmed ancestors', () => {
    const doc = {
      ...seeded(),
      nodes: seeded().nodes.map((n) =>
        n.ref === 'init' ? { ...n, status: 'confirmed' as const, objectId: 'ini_1' } : n,
      ),
    };
    expect(planNodeClosure(doc, ['t1'])).toEqual(['p1', 't1']);
  });
});

describe('planCounts', () => {
  it('counts by kind and draft', () => {
    expect(planCounts(seeded())).toEqual({ projects: 1, tasks: 1, draft: 3 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @docket/work exec vitest run tests/plan-draft.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the contract**

```ts
// domains/work/src/contracts/plan-draft.ts
import { z } from 'zod';
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { InitiativeId, LabelId, TemplateId } from '../ids';
import { Health } from './capability';
import { Priority } from '../task-contract';
import { InitiativeUpdateCadence } from './initiative';

export const PlanNodeKind = z.enum(['initiative', 'program', 'project', 'task']);
export type PlanNodeKind = z.infer<typeof PlanNodeKind>;
export const PlanNodeStatus = z.enum(['draft', 'confirmed']);
export type PlanNodeStatus = z.infer<typeof PlanNodeStatus>;

/** One flat field bag; the reducer enforces which keys each kind accepts. */
export const PlanNodeFields = z.object({
  title: z.string().min(1),
  summary: z.string().max(280).optional(),
  description: z.string().optional(),
  status: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  health: Health.optional(),
  updateCadence: InitiativeUpdateCadence.optional(),
  ownerId: ActorId.nullable().optional(),
  leadId: ActorId.nullable().optional(),
  assigneeId: ActorId.nullable().optional(),
  teamId: TeamId.nullable().optional(),
  labelIds: z.array(LabelId).optional(),
  targetDate: z.iso.date().nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  estimate: z.number().int().min(0).nullable().optional(),
});
export type PlanNodeFields = z.infer<typeof PlanNodeFields>;

export const PlanNode = z.object({
  ref: z.string().min(1).max(64),
  kind: PlanNodeKind,
  parentRef: z.string().nullable(),
  initiativeRefs: z.array(z.string()),
  initiativeIds: z.array(InitiativeId),
  fields: PlanNodeFields,
  templateId: TemplateId.nullable(),
  status: PlanNodeStatus,
  objectId: z.string().nullable(),
});
export type PlanNode = z.infer<typeof PlanNode>;

export const PlanEdge = z.object({
  fromRef: z.string(),
  toRef: z.string(),
  kind: z.literal('blocks'),
});
export type PlanEdge = z.infer<typeof PlanEdge>;

export const PlanDocument = z.object({ nodes: z.array(PlanNode), edges: z.array(PlanEdge) });
export type PlanDocument = z.infer<typeof PlanDocument>;

export const PlanUpsertNode = z.object({
  ref: z.string().min(1).max(64),
  kind: PlanNodeKind,
  parentRef: z.string().nullable().optional(),
  initiativeRefs: z.array(z.string()).optional(),
  initiativeIds: z.array(InitiativeId).optional(),
  fields: PlanNodeFields,
  templateId: TemplateId.nullable().optional(),
});

export const PlanOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_title'), title: z.string().min(1).max(200) }),
  z.object({ op: z.literal('upsert_node'), node: PlanUpsertNode }),
  z.object({ op: z.literal('set_fields'), ref: z.string(), fields: PlanNodeFields.partial() }),
  z.object({ op: z.literal('move_node'), ref: z.string(), parentRef: z.string().nullable() }),
  z.object({ op: z.literal('remove_node'), ref: z.string() }),
  z.object({ op: z.literal('add_edge'), fromRef: z.string(), toRef: z.string() }),
  z.object({ op: z.literal('remove_edge'), fromRef: z.string(), toRef: z.string() }),
  z.object({ op: z.literal('apply_template'), ref: z.string(), templateId: TemplateId }),
]);
export type PlanOp = z.infer<typeof PlanOp>;

export const PlanDraftStatus = z.enum(['active', 'committed', 'archived']);
export type PlanDraftStatus = z.infer<typeof PlanDraftStatus>;

/** What the read hydrates for a confirmed node from its real record. */
export const PlanObjectSnapshot = z.object({
  name: z.string(),
  statusName: z.string().nullable(),
  health: Health.nullable(),
  href: z.string(),
  archived: z.boolean(),
});
export type PlanObjectSnapshot = z.infer<typeof PlanObjectSnapshot>;

export const PlanDraftOut = z
  .object({
    id: z.string(),
    organizationId: OrganizationId,
    sessionId: z.string().nullable(),
    rootInitiativeId: InitiativeId.nullable(),
    title: z.string(),
    status: PlanDraftStatus,
    revision: z.number().int(),
    document: PlanDocument,
    objects: z.record(z.string(), PlanObjectSnapshot),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'PlanDraftOut', description: 'A personal planning draft and its document.' });
export type PlanDraftOut = z.infer<typeof PlanDraftOut>;

export const PlanDraftListOut = z.object({ items: z.array(PlanDraftOut) });

export const PlanDraftCreate = z
  .object({
    organizationId: OrganizationId,
    initiativeId: InitiativeId.optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .meta({ id: 'PlanDraftCreate', description: 'Start or reopen a planning draft.' });
export type PlanDraftCreate = z.infer<typeof PlanDraftCreate>;

export const PlanDraftPatch = z
  .object({
    revision: z.number().int().min(0),
    ops: z.array(PlanOp).min(1).max(200),
  })
  .meta({ id: 'PlanDraftPatch', description: 'A batch of draft operations against one revision.' });
export type PlanDraftPatch = z.infer<typeof PlanDraftPatch>;

export const PlanCommitBody = z
  .object({ refs: z.array(z.string()).min(1).max(200) })
  .meta({ id: 'PlanCommitBody', description: 'The draft nodes to create for real.' });
export type PlanCommitBody = z.infer<typeof PlanCommitBody>;

export const PlanPlaced = z.object({
  ref: z.string(),
  kind: PlanNodeKind,
  id: z.string(),
  created: z.boolean(),
});
export const PlanCommitOut = z
  .object({
    plan: PlanDraftOut,
    placed: z.array(PlanPlaced),
    changeSetId: z.string().nullable(),
  })
  .meta({ id: 'PlanCommitOut', description: 'The result of confirming part of a plan.' });
export type PlanCommitOut = z.infer<typeof PlanCommitOut>;

export const PlanTemplateOption = z.object({
  id: TemplateId,
  targetType: PlanNodeKind,
  name: z.string(),
  description: z.string().nullable(),
});
export type PlanTemplateOption = z.infer<typeof PlanTemplateOption>;

export const PLAN_TOOL_NAMES = {
  start: 'plan_start',
  read: 'plan_read',
  draft: 'plan_draft',
  commit: 'plan_commit',
} as const;
```

- [ ] **Step 4: Write the reducer**

```ts
// domains/work/src/plan-draft.ts
import type { TemplateDraft } from './contracts/template';
import type {
  PlanDocument,
  PlanNode,
  PlanNodeFields,
  PlanNodeKind,
  PlanOp,
} from './contracts/plan-draft';

export const EMPTY_PLAN_DOCUMENT: PlanDocument = { nodes: [], edges: [] };

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

export interface PlanOpEnvironment {
  templatePayload(templateId: string): TemplateDraft | undefined;
}

const ALLOWED_PARENTS: Record<PlanNodeKind, readonly PlanNodeKind[]> = {
  initiative: [],
  program: ['initiative'],
  project: ['program', 'initiative'],
  task: ['project'],
};
const FIELDS_BY_KIND: Record<PlanNodeKind, ReadonlySet<keyof PlanNodeFields>> = {
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
const TEMPLATE_FIELD_KEYS: Record<PlanNodeKind, readonly (keyof PlanNodeFields)[]> = {
  initiative: ['summary', 'description', 'status', 'priority', 'updateCadence', 'health'],
  program: ['summary', 'description', 'status', 'health'],
  project: ['summary', 'description', 'status', 'health'],
  task: ['description', 'priority', 'labelIds'],
};

export function planNode(document: PlanDocument, ref: string): PlanNode | undefined {
  return document.nodes.find((node) => node.ref === ref);
}

function assertFieldsForKind(
  index: number,
  kind: PlanNodeKind,
  fields: Partial<PlanNodeFields>,
): void {
  for (const key of Object.keys(fields) as (keyof PlanNodeFields)[]) {
    if (!FIELDS_BY_KIND[kind].has(key))
      throw new PlanOpError(index, `ops.${index}.fields.${key}`, `A ${kind} has no ${key}.`);
  }
}

function assertParent(
  index: number,
  doc: PlanDocument,
  kind: PlanNodeKind,
  parentRef: string | null,
  selfRef: string,
): void {
  if (parentRef === null) {
    if (kind !== 'initiative')
      throw new PlanOpError(index, `ops.${index}.parentRef`, `A ${kind} needs a parent.`);
    return;
  }
  if (parentRef === selfRef)
    throw new PlanOpError(index, `ops.${index}.parentRef`, 'A node cannot be its own parent.');
  const parent = planNode(doc, parentRef);
  if (!parent)
    throw new PlanOpError(index, `ops.${index}.parentRef`, `No node has ref "${parentRef}".`);
  if (!ALLOWED_PARENTS[kind].includes(parent.kind))
    throw new PlanOpError(
      index,
      `ops.${index}.parentRef`,
      `A ${kind} cannot sit under a ${parent.kind}.`,
    );
  // Walking up from the parent must never reach the node being moved.
  let cursor: PlanNode | undefined = parent;
  while (cursor) {
    if (cursor.ref === selfRef)
      throw new PlanOpError(index, `ops.${index}.parentRef`, 'That would make a cycle.');
    cursor = cursor.parentRef === null ? undefined : planNode(doc, cursor.parentRef);
  }
}

function subtreeRefs(doc: PlanDocument, ref: string): Set<string> {
  const out = new Set([ref]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of doc.nodes) {
      if (node.parentRef !== null && out.has(node.parentRef) && !out.has(node.ref)) {
        out.add(node.ref);
        grew = true;
      }
    }
  }
  return out;
}

function requireDraft(index: number, doc: PlanDocument, ref: string, path: string): PlanNode {
  const node = planNode(doc, ref);
  if (!node) throw new PlanOpError(index, path, `No node has ref "${ref}".`);
  if (node.status === 'confirmed')
    throw new PlanOpError(index, path, 'That node is already created; edit it in the workspace.');
  return node;
}

/** Order nodes so parents precede children, keeping the original order otherwise. */
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

function applyOne(
  doc: PlanDocument,
  op: PlanOp,
  index: number,
  env: PlanOpEnvironment,
): PlanDocument {
  switch (op.op) {
    case 'set_title':
      return doc;
    case 'upsert_node': {
      const existing = planNode(doc, op.node.ref);
      if (existing?.status === 'confirmed')
        throw new PlanOpError(
          index,
          `ops.${index}.node.ref`,
          'That node is already created; edit it in the workspace.',
        );
      const kind = existing?.kind ?? op.node.kind;
      if (existing && existing.kind !== op.node.kind)
        throw new PlanOpError(index, `ops.${index}.node.kind`, 'A node cannot change kind.');
      const parentRef =
        op.node.parentRef === undefined ? (existing?.parentRef ?? null) : op.node.parentRef;
      assertFieldsForKind(index, kind, op.node.fields);
      const next: PlanNode = {
        ref: op.node.ref,
        kind,
        parentRef,
        initiativeRefs: op.node.initiativeRefs ?? existing?.initiativeRefs ?? [],
        initiativeIds: op.node.initiativeIds ?? existing?.initiativeIds ?? [],
        fields: { ...existing?.fields, ...op.node.fields },
        templateId:
          op.node.templateId === undefined ? (existing?.templateId ?? null) : op.node.templateId,
        status: 'draft',
        objectId: null,
      };
      const nodes = existing
        ? doc.nodes.map((node) => (node.ref === next.ref ? next : node))
        : [...doc.nodes, next];
      const withNode = { ...doc, nodes };
      assertParent(index, withNode, kind, parentRef, next.ref);
      return withNode;
    }
    case 'set_fields': {
      const node = requireDraft(index, doc, op.ref, `ops.${index}.ref`);
      assertFieldsForKind(index, node.kind, op.fields);
      const fields = { ...node.fields, ...op.fields };
      if (fields.title.trim().length === 0)
        throw new PlanOpError(index, `ops.${index}.fields.title`, 'A title is required.');
      return { ...doc, nodes: doc.nodes.map((n) => (n.ref === op.ref ? { ...n, fields } : n)) };
    }
    case 'move_node': {
      const node = requireDraft(index, doc, op.ref, `ops.${index}.ref`);
      assertParent(index, doc, node.kind, op.parentRef, node.ref);
      return {
        ...doc,
        nodes: doc.nodes.map((n) => (n.ref === op.ref ? { ...n, parentRef: op.parentRef } : n)),
      };
    }
    case 'remove_node': {
      requireDraft(index, doc, op.ref, `ops.${index}.ref`);
      const gone = subtreeRefs(doc, op.ref);
      for (const ref of gone) {
        const node = planNode(doc, ref);
        if (node?.status === 'confirmed')
          throw new PlanOpError(
            index,
            `ops.${index}.ref`,
            'A created node is inside that subtree.',
          );
      }
      return {
        nodes: doc.nodes
          .filter((n) => !gone.has(n.ref))
          .map((n) => ({ ...n, initiativeRefs: n.initiativeRefs.filter((r) => !gone.has(r)) })),
        edges: doc.edges.filter((e) => !gone.has(e.fromRef) && !gone.has(e.toRef)),
      };
    }
    case 'add_edge': {
      const from = planNode(doc, op.fromRef);
      const to = planNode(doc, op.toRef);
      if (!from)
        throw new PlanOpError(index, `ops.${index}.fromRef`, `No node has ref "${op.fromRef}".`);
      if (!to) throw new PlanOpError(index, `ops.${index}.toRef`, `No node has ref "${op.toRef}".`);
      if (from.ref === to.ref)
        throw new PlanOpError(index, `ops.${index}.toRef`, 'A node cannot block itself.');
      if (from.kind !== to.kind || from.kind === 'initiative')
        throw new PlanOpError(
          index,
          `ops.${index}.toRef`,
          'Dependencies join two projects or two tasks.',
        );
      if (from.status === 'confirmed' && to.status === 'confirmed')
        throw new PlanOpError(
          index,
          `ops.${index}.toRef`,
          'Both are already created; link them in the workspace.',
        );
      if (doc.edges.some((e) => e.fromRef === op.fromRef && e.toRef === op.toRef)) return doc;
      return {
        ...doc,
        edges: [...doc.edges, { fromRef: op.fromRef, toRef: op.toRef, kind: 'blocks' }],
      };
    }
    case 'remove_edge':
      return {
        ...doc,
        edges: doc.edges.filter((e) => !(e.fromRef === op.fromRef && e.toRef === op.toRef)),
      };
    case 'apply_template': {
      const node = requireDraft(index, doc, op.ref, `ops.${index}.ref`);
      const payload = env.templatePayload(op.templateId);
      if (!payload)
        throw new PlanOpError(
          index,
          `ops.${index}.templateId`,
          'That template does not exist here.',
        );
      if (payload.targetType !== node.kind)
        throw new PlanOpError(
          index,
          `ops.${index}.templateId`,
          `That template creates a ${payload.targetType}.`,
        );
      const fields = { ...node.fields };
      for (const key of TEMPLATE_FIELD_KEYS[node.kind]) {
        const value = (payload as Record<string, unknown>)[key];
        if (value !== undefined && fields[key] === undefined)
          (fields as Record<string, unknown>)[key] = value;
      }
      return {
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.ref === op.ref ? { ...n, fields, templateId: op.templateId } : n,
        ),
      };
    }
  }
}

/** Apply a batch atomically; throws {@link PlanOpError} and leaves `document` untouched. */
export function applyPlanOps(
  document: PlanDocument,
  ops: readonly PlanOp[],
  env: PlanOpEnvironment,
): PlanDocument {
  let next = document;
  ops.forEach((op, index) => {
    next = applyOne(next, op, index, env);
  });
  return { ...next, nodes: parentsFirst(next.nodes) };
}

/** The refs plus every unconfirmed ancestor, parents first. */
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

export function planCounts(document: PlanDocument): {
  projects: number;
  tasks: number;
  draft: number;
} {
  return {
    projects: document.nodes.filter((n) => n.kind === 'project').length,
    tasks: document.nodes.filter((n) => n.kind === 'task').length,
    draft: document.nodes.filter((n) => n.status === 'draft').length,
  };
}
```

`set_title` is a no-op in the reducer because the title is a column; the store applies it. Add the two exports to `domains/work/package.json`.

- [ ] **Step 5: Run tests, typecheck, lint the package**

Run: `pnpm --filter @docket/work exec vitest run tests/plan-draft.test.ts && pnpm --filter @docket/work typecheck && pnpm --filter @docket/work lint`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

`feat(athena): Define the plan draft document and its reducer`

---

### Task 2: The `plan_draft` table

**Files:**

- Modify: `packages/db/src/schema/crosscutting.ts` (after `template`)
- Create: `packages/db/drizzle/0125_plan_draft.sql` via `pnpm db:generate`
- Test: `packages/db` policy tests already assert migrations match the schema (`pnpm --filter @docket/db test`).

- [ ] **Step 1: Add the table**

```ts
export const planDraftStatus = pgEnum('plan_draft_status', ['active', 'committed', 'archived']);

export const planDraft = pgTable(
  'plan_draft',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => agentSession.id, { onDelete: 'set null' }),
    rootInitiativeId: text('root_initiative_id').references(() => initiative.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    status: planDraftStatus('status').notNull().default('active'),
    revision: integer('revision').notNull().default(0),
    document: jsonb('document').$type<PlanDocument>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [
    index('plan_draft_owner_status_idx').on(t.ownerUserId, t.status),
    uniqueIndex('plan_draft_owner_root_active_uq')
      .on(t.ownerUserId, t.rootInitiativeId)
      .where(sql`${t.status} = 'active' AND ${t.rootInitiativeId} IS NOT NULL`),
    notBlank('plan_draft_title_not_blank', t.title),
  ],
);
```

Import `agentSession` from `./agents` if crosscutting does not already; if that creates a cycle, place the table in `packages/db/src/schema/agents.ts` after `athenaAssignment` instead and note it in the spec doc.

- [ ] **Step 2: Generate the migration, run db tests**

Run: `pnpm db:generate && pnpm --filter @docket/db typecheck && pnpm --filter @docket/db test`
Expected: `0125_plan_draft.sql` created; PASS.

- [ ] **Step 3: Commit** — `feat(athena): Persist personal plan drafts`

---

### Task 3: Extract organize placement into a shared module

**Files:**

- Create: `apps/api/src/lib/organize/place.ts`
- Modify: `apps/api/src/mcp/organize-tool.ts`
- Test: existing `apps/api/tests/mcp/organize*.test.ts` stay green.

**Interfaces:**

- Produces: `OrganizeItem` schema/type, `KINDS`, `Placed`, `Placement`, `PlaceInput`, `inParentOrder(items)`, `assertPriorities(items)`, `resolveItem(orgId, item)`, `placeItem(tx, input)`, `Tx`.

- [ ] **Step 1: Move** the item schema, `KINDS`, `ALLOWED_PARENTS`, `Placed`, `reject`, `inParentOrder`, `assertPriorities`, `Placement`, `ItemRefs`, `resolveItem`, `PlaceInput`, `Tx`, and `placeItem` verbatim into `apps/api/src/lib/organize/place.ts`, exporting each. Keep `registerOrganizeTool` in `organize-tool.ts` importing them.
- [ ] **Step 2: Run** `pnpm --filter @docket/api exec vitest run tests/mcp/organize` and `pnpm --filter @docket/api typecheck`. Expected: PASS.
- [ ] **Step 3: Commit** — `chore(mcp): Share organize placement with the planning commit`

---

### Task 4: Plan draft store and `/v1/me/plans` routes

**Files:**

- Create: `apps/api/src/lib/plan-draft/store.ts`
- Create: `apps/api/src/routes/me-plans.ts`
- Modify: `apps/api/src/app.ts` (`.route('/me/plans', mePlans)`)
- Test: `apps/api/tests/routes/me-plans.test.ts`

**Interfaces:**

- Produces:
  - `loadOwnedPlan(ownerUserId, id): Promise<PlanDraftRow>` (404 when missing or not owned)
  - `createOrReopenPlan(ownerUserId, input: PlanDraftCreate & { sessionId?: string | null }): Promise<PlanDraftRow>`
  - `patchPlan(ownerUserId, id, patch: PlanDraftPatch): Promise<PlanDraftRow>` (409 `plan_revision_stale` with current plan in `extensions.plan`)
  - `archivePlan(ownerUserId, id)`
  - `presentPlan(row): Promise<PlanDraftOut>` (hydrates `objects` from initiative/project/task rows; `href` uses `/orgs/{orgId}/{initiatives|projects|tasks}/{id}`)
  - `listPlanTemplates(orgId, actorId): Promise<PlanTemplateOption[]>` (calls `seedDefaultTemplates` first, filters by visible scope like `templates.ts`)
  - `planTemplateEnvironment(orgId): Promise<PlanOpEnvironment>` (loads templates once per patch)

- [ ] **Step 1: Write the failing route tests**

```ts
// apps/api/tests/routes/me-plans.test.ts — pattern from templates.test.ts
describe('/v1/me/plans', () => {
  it('creates a plan rooted on an existing initiative once and reopens it after', ...);   // second POST returns same id
  it('hides another owner’s plan', ...);                                                   // GET → 404
  it('applies ops and bumps the revision', ...);                                            // PATCH revision 0 → revision 1, nodes present
  it('rejects a stale revision with 409 and the current plan', ...);                       // body.code === 'plan_revision_stale', body.plan.revision
  it('reports reducer rejections as 422 naming the op path', ...);
  it('applies a template through apply_template', ...);
  it('hydrates a confirmed node from its real record', ...);                               // objects[ref].name
  it('archives without creating anything', ...);
});
```

Each test uses `appWithActor` and `seedBaseOrg` from `../support/routes-harness`; seed the plan through `POST /` then act.

- [ ] **Step 2: Run** — `pnpm --filter @docket/api exec vitest run tests/routes/me-plans.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the store**

Key behaviour:

- `createOrReopenPlan`: when `initiativeId` is given, look for an active plan `(ownerUserId, rootInitiativeId)`; return it if present. Otherwise insert with `document` = `EMPTY_PLAN_DOCUMENT` plus, when rooted, one confirmed initiative node `{ ref: 'root', kind: 'initiative', status: 'confirmed', objectId: initiativeId, fields: { title: initiative.name } }`. Title defaults to the initiative's name or `'New plan'`. Verify the initiative belongs to `organizationId` (404 otherwise).
- `patchPlan`: `db.transaction` → `select ... for update` → compare `revision`; on mismatch throw `ConflictError('plan_revision_stale')` carrying `plan` (present via `presentPlan`) so the route returns it in the Problem `extensions`; apply `set_title` ops to the column; run `applyPlanOps` with `planTemplateEnvironment`; map `PlanOpError` to `ValidationError` with a Zod issue at `[op.path]`; write `document`, `revision + 1`.
- `presentPlan`: gather `objectId`s by kind, read names/status/health/archivedAt in three batched selects, build `objects`.
- `listPlanTemplates`: `seedDefaultTemplates(orgId, actorId)` then select visible templates, map to `PlanTemplateOption`.

Use `internalUserContext(userId)` + `scopedActor(ctx, orgId, 'work:read')` from `../mcp/auth` and `../mcp/result` to resolve the owner's actor for template visibility.

- [ ] **Step 4: Implement the router** (`GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `POST /:id/archive`; `apiDoc` tag `Me`, responses `PlanDraftListOut`/`PlanDraftOut`) and mount it.

- [ ] **Step 5: Run tests + typecheck + lint** for `@docket/api`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat(api): Read and edit personal plan drafts`

---

### Task 5: Commit service and route

**Files:**

- Create: `apps/api/src/lib/plan-draft/commit.ts`
- Modify: `apps/api/src/routes/me-plans.ts` (`POST /:id/commit`)
- Test: `apps/api/tests/lib/plan-draft-commit.test.ts`, extend `me-plans.test.ts`

**Interfaces:**

- Produces: `commitPlanNodes(input: { row: PlanDraftRow; refs: readonly string[]; actorId: string; origin: ChangeOrigin }): Promise<{ row: PlanDraftRow; placed: Placed[]; changeSetId: string | null }>`

- [ ] **Step 1: Failing tests**

```ts
it('closes over unconfirmed ancestors and creates parents first'); // commit ['t1'] creates init, p1, t1
it('matches an existing project by name instead of duplicating'); // second commit → created:false
it('links a project to its initiativeRefs and initiativeIds'); // initiative_project rows
it('creates dependency edges only when both ends are confirmed');
it('writes objectId and status back and bumps revision');
it('records a change set the undo tool can read');
it('rolls back everything when one node fails'); // e.g. team missing → no rows
it('marks the plan committed when no draft node remains');
it('route: refuses without contribute and returns application copy');
```

- [ ] **Step 2: Implement**

Map each closure ref to an `OrganizeItem`:

- `kind`, `title: fields.title`, `description`, `parent`: `parentRef` when that parent is in this closure; otherwise `project`/`program`/`initiative` set to the confirmed parent's `objectId`, for tasks `project`, for projects `initiative`.
- `assignee`/`owner`/`lead`/`team` as ids (descriptors accept ids), `priority`, `state: fields.status`, `dueDate`, `targetDate`.
  Then reuse `inParentOrder`, `assertPriorities`, `resolveItem`, `resolveLandingTarget`, `resolveStateTransition`, `serializableTx`, and `placeItem` exactly as `organize-tool.ts` does. Inside the same transaction: insert `initiativeProject` rows for every `initiativeRefs` (resolved via placed) and `initiativeIds` with `onConflictDoNothing`; insert `projectDependency`/`taskDependency` rows for edges whose two ends are confirmed after this commit; update the plan row's document (`objectId`, `status: 'confirmed'`), `revision + 1`, `status: 'committed'` when no draft remains; `recordChangeSetInTx`. After commit: `enqueueSearchUpsert` for created rows and `finishTaskStateTransition` for cascades.

Route: `POST /:id/commit` → `internalUserContext(userId)`, `scopedActor(ctx, row.organizationId, 'work:write')`, `authorize(actorCtx, 'contribute', { kind: 'organization', ... })`, then `commitPlanNodes`; respond `PlanCommitOut`.

- [ ] **Step 3: Run tests, typecheck, lint.** Expected: PASS.
- [ ] **Step 4: Commit** — `feat(api): Confirm plan draft nodes into real work`

---

### Task 6: Athena's plan tools

**Files:**

- Create: `apps/api/src/mcp/plan-draft-tools.ts`
- Modify: `apps/api/src/mcp/tools.ts` (`registerPlanDraftTools(server, ctx, sessionId)`)
- Test: `apps/api/tests/mcp/plan-draft-tools.test.ts`

- [ ] **Step 1: Failing tests** (use the in-process client pattern from `tests/mcp/organize*.test.ts`)

```ts
it('plan_start creates a plan, links the session, and returns href + templates');
it('plan_start reopens the active plan for an initiative');
it('plan_read returns the document and revision');
it('plan_draft applies ops and returns the next revision and a change summary');
it('plan_draft rejects a stale revision with the current revision in the error');
it('plan_commit creates the refs and returns placed items');
it('every plan tool 404s for a plan another user owns');
it(
  'plan_start and plan_draft carry the private-draft annotation; plan_read is read-only; plan_commit is neither',
);
```

- [ ] **Step 2: Implement**

Tool definitions (all `runTool`):

- `plan_start` input `{ orgId, initiative?: string, title?: string }`; output `{ planId, href, title, revision, document, templates }`. `href` = `/orgs/${orgId}/plans/${planId}`. `_meta: { 'docket/approval': 'private_draft' }`, annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`. Sets `sessionId` on the plan when `sessionId` is non-null and the plan has none.
- `plan_read` input `{ planId }`; output `PlanDraftOut` fields; `readOnlyHint: true`.
- `plan_draft` input `{ planId, revision, ops: PlanOp[] }`; output `{ revision, added: string[], changed: string[], removed: string[], counts }`; same `_meta` as start. Summary derived by diffing refs before and after.
- `plan_commit` input `{ planId, refs }`; output `{ placed, created, matched, changeSetId, revision }`; `_meta: widgetMeta(WIDGET.changeReport)`; write annotations like `organize`.
  Principal must be `kind: 'user'`; agents get 404.

- [ ] **Step 3: Run tests, typecheck, lint.** Expected: PASS.
- [ ] **Step 4: Commit** — `feat(mcp): Let Athena draft and confirm plans on the canvas`

---

### Task 7: Private-draft gating

**Files:**

- Modify: `apps/api/src/agent/approval-policy.ts`, `apps/api/src/agent/toolbox.ts`, `apps/api/src/agent/loop.ts`
- Modify: `docs/engineering/specs/mcp-surface.md` (§3.2.1 sibling: "3.2.2 Approval metadata")
- Test: `apps/api/tests/agent/approval-policy.test.ts` (extend), `apps/api/tests/agent/toolbox*.test.ts` (extend)

- [ ] **Step 1: Failing tests**

```ts
it('a first-party private-draft tool executes under act_with_approval and autonomous');
it('a first-party private-draft tool records only under suggest');
it('a remote tool claiming private-draft is still a gated write');
it('the toolbox reports privateDraft for docket tools carrying _meta["docket/approval"]');
```

- [ ] **Step 2: Implement**

`ToolAnnotationHints` gains `privateDraft?: boolean`. `ToolClassification` gains `privateDraft: boolean` = `source === 'first_party' && annotations?.privateDraft === true`. `decideToolExecution`: when `classification.privateDraft`, return `policy === 'suggest' ? 'record_only' : 'execute'`. `decideUserOwnedToolExecution`: when `privateDraft`, return `personalMode === 'suggest_only' ? 'record_only' : 'execute'`. Toolbox: read `tool._meta?.['docket/approval'] === 'private_draft'` into the hints map (first-party list only). `openToolbox(executor, sessionId: string | null = null)` passes it to `buildServer(ctx, sessionId)`; the loop passes `sessionId`.

- [ ] **Step 3: Doc** the annotation in `mcp-surface.md`.
- [ ] **Step 4: Run agent tests, typecheck, lint.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(athena): Let private plan drafts skip the approval gate`

---

### Task 8: Planning guidance in the system prompt

**Files:**

- Modify: `apps/api/src/agent/system-prompt.ts`, `apps/api/src/agent/loop.ts`
- Test: `apps/api/tests/agent/system-prompt.test.ts` (extend)

- [ ] **Step 1: Failing tests** — prompt contains the planning section always; with `activePlan: { id, title, revision, href, counts }` it names the plan id and revision and says to read it first.
- [ ] **Step 2: Implement** `SystemPromptInput.activePlan?: { id: string; title: string; revision: number; counts: { projects: number; tasks: number; draft: number } } | null`. Text (verbatim):

```
Planning on the canvas: when the person describes initiative-sized work — a launch, a campaign, a quarter's goal, anything with several efforts inside it — call `plan_start` and tell them in one sentence that you have opened a plan they can shape with you on the canvas. While a plan is active: call `plan_read` at the start of every turn before you change it; write in batches through ONE `plan_draft` call per turn; when you first draft a node, pick the most relevant template from the list `plan_start` returned and apply it in the same batch; ask about one unit of work at a time, in plain words, and infer names and structure from what they tell you rather than asking for a list; when they have settled a part, call `plan_commit` for exactly that part and say what it will create.
```

Active-plan line: `Active plan: "${title}" (id ${id}, revision ${revision}; ${projects} projects, ${tasks} tasks, ${draft} draft). Read it before editing.`
Loop: before `buildSystemPrompt`, select the newest active `planDraft` with `sessionId = session.id`.

- [ ] **Step 3: Run tests, typecheck, lint. Commit** — `feat(athena): Teach Athena to plan on the canvas`

---

### Task 9: Web data layer for plans

**Files:**

- Create: `apps/web/src/lib/plan-draft/defs.ts`
- Modify: `apps/web/src/lib/query-keys.ts` (`plans: () => ['me','plans']`, `plan: (id) => ['me','plans',id]`)
- Test: `apps/web/tests/lib/plan-draft-defs.test.tsx`

**Interfaces:**

- Produces: `planDef(planId)`, `usePlan(planId, { live: boolean })` (2 s when live, 10 s otherwise), `usePlanOps(planId)` → `{ apply(ops): Promise<void>, pending, error }` with optimistic reducer application and 409 rebase, `useCommitPlan(planId)`, `useCreatePlan()`, `useArchivePlan(planId)`, `useSessionPlanRefetch(orgId, sessionId, planId)` (subscribes to the session SSE and invalidates the plan on `plan_draft`/`plan_commit` actions).

- [ ] **Step 1: Failing tests** — optimistic apply updates cache before the response; a 409 replays the unacknowledged ops on the returned plan and retries once; a reducer failure surfaces application copy.
- [ ] **Step 2: Implement** using `apiQueryOptions`, `useApiMutation`, `applyPlanOps` with `templatePayload: () => undefined` (template ops are not applied optimistically; they wait for the server).
- [ ] **Step 3: Run, typecheck, lint. Commit** — `feat(web): Read and edit plan drafts through the query layer`

---

### Task 10: Projection, layout, and diff

**Files:**

- Create: `apps/web/src/components/plan-canvas/plan-nodes.ts`, `plan-layout.ts`, `plan-diff.ts`
- Test: `apps/web/tests/plan-canvas/plan-nodes.test.ts`, `plan-layout.test.ts`, `plan-diff.test.ts`

**Interfaces:**

- `projectPlan(plan: PlanDraftOut, orgId): { nodes: Node[]; edges: Edge[] }` — node ids are refs; types `planInitiative`, `planProject` (container), `planTask`; edges: `initiative→project` typed `planLink` (dashed, unselectable), `blocks` typed `default` (the existing `DependencyEdge`).
- `layoutPlan(nodes, edges, aspectRatio, epoch): Node[]` — group tasks by parent project through `layoutGrouped`-style packing (copy the group container math with `PLAN_PROJECT_HEADER = 56`), then place initiative cards in a leading column and pack containers with `layoutMeasuredGraph`.
- `planDiff(prev, next): { added: string[]; removed: string[]; changed: Map<string, string[]> }`.

- [ ] **Step 1: Failing tests** (projection kinds/parents/extent, layout keeps tasks inside their container bounds, diff detects field changes and reverts).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run, typecheck, lint. Commit** — `feat(web): Project plan drafts onto the canvas`

---

### Task 11: The plan canvas surface

**Files:**

- Create: `plan-initiative-node.tsx`, `plan-project-node.tsx`, `plan-task-node.tsx`, `plan-inspector.tsx`, `plan-canvas-panel.tsx`, `plan-canvas.css` (motion keyframes, imported once)
- Create: `apps/web/src/app/(app)/orgs/[orgId]/plans/[planId]/page.tsx`, `plan-client.tsx`
- Regenerate: `apps/web/src/lib/offline-routes.generated.ts`
- Test: `apps/web/tests/plan-canvas/plan-canvas-panel.test.tsx`, `plan-inspector.test.tsx`

Behaviour checklist (each a test):

- Chrome is `AppBar` with back to the initiative (when rooted) or to the workspace Initiatives list, the plan title, a `GraphViewBar`-style search, and counts `projects · tasks · draft`.
- Draft nodes carry `data-plan-status="draft"` and the ghost classes; confirmed nodes render a `created` mark and an Open link.
- Selecting a draft project shows the inspector editor with title, summary, lead, target date, initiatives; Confirm button label names counts (`Confirm project and 2 tasks`).
- Selection bar Confirm calls commit with the selected refs and morphs nodes via `startViewTransition`.
- Pane menu offers Add project; a project container offers Add task; Remove offers Undo through `CanvasCommandNotice`.
- Edge connect between two projects emits `add_edge`; Delete on a selected edge emits `remove_edge`; dragging a task onto another container emits `move_node`.
- A revision change animates added nodes (`data-entered`) and highlights changed fields; the status pill reads the count; reduced motion disables both.
- Below 768 px the inspector covers the canvas (via `GraphInspectorHost`).

- [ ] Implement, test, regenerate offline routes (`pnpm --filter @docket/web exec tsx scripts/generate-offline-routes.ts`), typecheck, lint.
- [ ] **Commit** — `feat(web): Plan initiatives on the canvas with Athena`

---

### Task 12: Entry points

**Files:**

- Create: `apps/web/src/components/plan-canvas/plan-start-card.tsx`
- Modify: `apps/web/src/components/athena/athena-conversation.tsx` (`ChatEntry` renders `PlanStartCard` when `action.kind === 'plan_start'` and the result carries `planId`+`href`)
- Modify: `initiative-detail-client.tsx` (Plan with Athena in the actions `ControlGroup`, uses `useCreatePlan` then `router.push(href)` and `openAthena({ workspaceId, source: { type: 'initiative', id, label } }, draft)`)
- Modify: `plan-client.tsx` (on mount, `openAthena(context)` when the rail is available)
- Test: `apps/web/tests/athena/plan-start-card.test.tsx`, extend `apps/web/tests/initiatives/*detail*.test.tsx`

- [ ] Failing tests → implement → run → commit — `feat(athena): Open the planning canvas from the thread and from an initiative`

---

### Task 13: Visual verification and design critique

- [ ] `bash scripts/dev-stack.sh start` → `eval "$(bash scripts/dev-stack.sh env)"` → `dev-session.ts --label=plan-canvas`.
- [ ] Seed through the API: create a plan with `POST /v1/me/plans`, patch a realistic document (1 initiative, 3 projects, 7 tasks, 2 dependencies, one confirmed project).
- [ ] `capture-shots.ts` for `/orgs/:orgId/plans/<id>` and the initiative detail page; also capture with the Athena rail open.
- [ ] Review each shot against the Docket craft rubric: hierarchy, density, ghost legibility in dark mode, container header rhythm, selection bar placement, inspector width, empty state, mobile cover behaviour. Fix and recapture. Record the scorecard in `docs/design/audits/2026-09-05-planning-canvas.md`.
- [ ] `pnpm db:reset` afterwards.
- [ ] Commit fixes — `fix(web): Polish the planning canvas after visual review`

---

### Task 14: End to end, docs, gates

- [ ] `apps/web/e2e/athena/plan-canvas.spec.ts`: sign up, seed a plan through the API, open the thread with a fixture `plan_start` action, click Open canvas, assert the canvas route with the rail visible, confirm a project, assert it appears on the initiative detail.
- [ ] `docs/engineering/specs/planning-canvas.md` (reader/decision/data/tools/commit/surface/testing), README mention under Athena, WORKLOG completion entry.
- [ ] Gates: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`, `pnpm build`.
- [ ] Commit — `feat(athena): Document and verify the planning canvas end to end`
