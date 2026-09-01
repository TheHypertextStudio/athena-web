import { describe, expect, it } from 'vitest';

import {
  CommentCreate,
  CommentListQuery,
  CommentOut,
  CommentSubjectType,
  CommentUpdate,
} from '@docket/work/comment-contract';

import {
  CycleCarryoverDecision,
  CycleCreate,
  CycleOut,
  CycleStatus,
  CycleUpdate,
} from '@docket/work/cycle-contract';

import {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  EntityDisplaySubjectType,
  EntityDisplayUpdate,
  TEAM_DEFAULT_COLOR_KEYS,
  defaultEntityDisplay,
} from '@docket/work/entity-display-contract';

import {
  InitiativeCreate,
  InitiativeHierarchyLinkCreate,
  InitiativeHierarchyLinkMove,
  DEFAULT_INITIATIVE_STATUS_KEYS,
  InitiativeHierarchyLinkOut,
  InitiativeOut,
  InitiativeStatus,
  InitiativeUpdate,
} from '@docket/work/initiative-contract';

import {
  LABEL_COLOR_KEYS,
  LabelCreate,
  LabelGroupCreate,
  LabelGroupOut,
  LabelMerge,
  LabelOut,
  LabelUpdate,
  nextLabelColor,
  normalizeLabelName,
} from '@docket/work/label-contract';

import {
  MilestoneCreate,
  MilestoneListQuery,
  MilestoneOut,
  MilestoneUpdate,
} from '@docket/work/milestone-contract';

import {
  DEFAULT_PROGRAM_STATUS_KEYS,
  ProgramCreate,
  ProgramOut,
  ProgramStatus,
  ProgramUpdate,
} from '@docket/work/program-contract';

import {
  SavedViewCreate,
  SavedViewOut,
  SavedViewUpdate,
  ViewFilter,
  ViewGrouping,
  ViewScope,
  ViewSort,
} from '@docket/work/saved-view-contract';

import {
  TaskCreate,
  TaskDependencyCreate,
  TaskOut,
  TaskProvenance,
  TaskReparentBatchIn,
  TaskReparentBatchOut,
  TaskUpdate,
  dependencyEdgeId,
  subtaskEdgeId,
} from '@docket/work/task-model';

import {
  UpdateCreate,
  UpdateListQuery,
  UpdateOut,
  UpdateSubjectType,
} from '@docket/work/update-contract';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const ID2 = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

const ID3 = '01BX5ZZKBKACTAV9WEVGEMMVS0';

describe('task DTOs', () => {
  it('TaskReparentBatchIn parses atomic hierarchy moves', () => {
    expect(
      TaskReparentBatchIn.parse({
        moves: [
          { taskId: ID, parentTaskId: ID3 },
          { taskId: ID2, parentTaskId: null },
        ],
        preserveSelectedSubtrees: true,
      }),
    ).toEqual({
      moves: [
        { taskId: ID, parentTaskId: ID3 },
        { taskId: ID2, parentTaskId: null },
      ],
      preserveSelectedSubtrees: true,
    });
  });
  it('TaskReparentBatchIn rejects empty and duplicate subject sets', () => {
    expect(
      TaskReparentBatchIn.safeParse({ moves: [], preserveSelectedSubtrees: true }).success,
    ).toBe(false);
    expect(
      TaskReparentBatchIn.safeParse({
        moves: [
          { taskId: ID, parentTaskId: ID2 },
          { taskId: ID, parentTaskId: ID3 },
        ],
        preserveSelectedSubtrees: false,
      }).success,
    ).toBe(false);
  });
  it('TaskReparentBatchOut preserves each committed root previous parent', () => {
    expect(
      TaskReparentBatchOut.parse({
        moves: [
          { taskId: ID, previousParentTaskId: null, parentTaskId: ID3 },
          { taskId: ID2, previousParentTaskId: ID, parentTaskId: ID3 },
        ],
      }).moves,
    ).toHaveLength(2);
  });
  it('TaskCreate parses minimal and full', () => {
    expect(TaskCreate.parse({ title: 'T', teamId: ID }).teamId).toBe(ID);
    const full = TaskCreate.parse({
      title: 'T',
      description: 'd',
      teamId: ID,
      state: 'todo',
      priority: 'high',
      assigneeId: ID2,
      projectId: ID,
      milestoneId: ID2,
      cycleId: ID,
      parentTaskId: ID2,
      estimate: 3,
      startDate: '2026-01-01',
      dueDate: '2026-02-01',
      labels: [ID],
    });
    expect(full.priority).toBe('high');
    expect(full.startDate).toBe('2026-01-01');
  });
  it('TaskCreate keeps description optional (title is the only required content field)', () => {
    expect(TaskCreate.parse({ title: 'T', teamId: ID }).description).toBeUndefined();
  });
  it('rejects duplicate related tasks while allowing one reciprocal link', () => {
    expect(
      TaskCreate.parse({ title: 'T', teamId: ID, relatedTaskIds: [ID2] }).relatedTaskIds,
    ).toEqual([ID2]);
    expect(
      TaskCreate.safeParse({ title: 'T', teamId: ID, relatedTaskIds: [ID2, ID2] }).success,
    ).toBe(false);
    expect(TaskUpdate.safeParse({ relatedTaskIds: [ID2, ID2] }).success).toBe(false);
  });
  it('TaskCreate rejects empty title and missing teamId', () => {
    expect(TaskCreate.safeParse({ title: '', teamId: ID }).success).toBe(false);
    expect(TaskCreate.safeParse({ title: 'T' }).success).toBe(false);
  });
  it('TaskCreate rejects a malformed startDate', () => {
    expect(TaskCreate.safeParse({ title: 'T', teamId: ID, startDate: 'nope' }).success).toBe(false);
  });
  it('TaskCreate rejects a non-integer estimate', () => {
    expect(TaskCreate.safeParse({ title: 'T', teamId: ID, estimate: 1.5 }).success).toBe(false);
  });
  it('TaskProvenance parses native and linked', () => {
    expect(TaskProvenance.parse({ source: 'native' }).source).toBe('native');
    const linked = TaskProvenance.parse({
      source: 'linked',
      sourceIntegrationId: 'int',
      externalId: 'ext',
      externalUrl: 'http://x',
      syncMode: 'mirror',
    });
    expect(linked.syncMode).toBe('mirror');
  });
  it('TaskProvenance rejects a bad source', () => {
    expect(TaskProvenance.safeParse({ source: 'imported' }).success).toBe(false);
  });
  it('TaskOut parses', () => {
    const parsed = TaskOut.parse({
      labels: [],
      id: ID,
      organizationId: ID2,
      title: 'T',
      description: null,
      summary: null,
      teamId: ID,
      state: 'todo',
      priority: 'none',
      autoCompletedBySubtasks: false,
      assigneeId: null,
      delegateId: null,
      projectId: null,
      programId: null,
      startDate: null,
      dueDate: null,
      provenance: { source: 'native' },
      createdAt: 'x',
      updatedAt: 'x',
    });
    expect(parsed.provenance.source).toBe('native');
    expect(parsed.startDate).toBeNull();
  });
  it('TaskOut rejects a missing provenance', () => {
    expect(
      TaskOut.safeParse({
        id: ID,
        organizationId: ID2,
        title: 'T',
        teamId: ID,
        state: 'todo',
        priority: 'none',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
  it('TaskUpdate parses partial and rejects empty title', () => {
    expect(TaskUpdate.parse({ state: 'done' }).state).toBe('done');
    expect(TaskUpdate.parse({}).title).toBeUndefined();
    expect(TaskUpdate.safeParse({ title: '' }).success).toBe(false);
  });
  it('TaskUpdate sets and clears startDate', () => {
    expect(TaskUpdate.parse({ startDate: '2026-05-01' }).startDate).toBe('2026-05-01');
    expect(TaskUpdate.parse({ startDate: null }).startDate).toBeNull();
  });
  it('builds the same synthetic dependency-graph edge id the API and web cache both derive', () => {
    expect(dependencyEdgeId(ID, ID2)).toBe(`dep:${ID}:${ID2}`);
    expect(subtaskEdgeId(ID, ID2)).toBe(`sub:${ID}:${ID2}`);
  });
});

describe('initiative DTOs', () => {
  it('InitiativeStatus carries a workspace-defined key', () => {
    // A workspace names its own Initiative statuses, so the DTO holds a key rather than a fixed
    // value; what is legal is decided against that workspace's set, not here.
    for (const key of DEFAULT_INITIATIVE_STATUS_KEYS) {
      expect(InitiativeStatus.parse(key)).toBe(key);
    }
    expect(InitiativeStatus.parse('awaiting_board')).toBe('awaiting_board');
    expect(InitiativeStatus.safeParse('').success).toBe(false);
  });
  it('InitiativeCreate parses minimal + full', () => {
    expect(InitiativeCreate.parse({ name: 'I' }).name).toBe('I');
    const full = InitiativeCreate.parse({
      name: 'I',
      description: 'd',
      summary: 'A concise strategic outcome.',
      ownerId: ID,
      status: 'active',
      priority: 'high',
      updateCadence: 'biweekly',
      targetDate: '2026-01-01',
      health: 'at_risk',
    });
    expect(full.health).toBe('at_risk');
    expect(full.priority).toBe('high');
    expect(full.updateCadence).toBe('biweekly');
  });
  it('InitiativeCreate rejects summaries longer than 280 characters', () => {
    expect(InitiativeCreate.safeParse({ name: 'I', summary: 'x'.repeat(281) }).success).toBe(false);
  });
  it('InitiativeCreate rejects empty name', () => {
    expect(InitiativeCreate.safeParse({ name: '' }).success).toBe(false);
  });
  it('InitiativeUpdate parses nullable fields', () => {
    const parsed = InitiativeUpdate.parse({
      name: 'I',
      ownerId: null,
      targetDate: null,
      health: null,
    });
    expect(parsed.ownerId).toBeNull();
    expect(parsed.targetDate).toBeNull();
    expect(parsed.health).toBeNull();
  });
  it('InitiativeUpdate rejects empty name', () => {
    expect(InitiativeUpdate.safeParse({ name: '' }).success).toBe(false);
  });
  it('validates context-owned Initiative hierarchy links', () => {
    const create = InitiativeHierarchyLinkCreate.parse({
      parentInitiativeId: ID,
      childInitiativeId: ID2,
    });
    expect(create.childInitiativeId).toBe(ID2);
    expect(InitiativeHierarchyLinkMove.parse({ parentInitiativeId: ID3 }).parentInitiativeId).toBe(
      ID3,
    );
    expect(
      InitiativeHierarchyLinkOut.parse({
        id: ID3,
        contextOrganizationId: ID,
        parentInitiativeId: ID2,
        childInitiativeId: ID3,
        createdAt: '2026-07-13T12:00:00.000Z',
      }).contextOrganizationId,
    ).toBe(ID);
  });
  it('InitiativeOut parses', () => {
    const parsed = InitiativeOut.parse({
      id: ID,
      organizationId: ID2,
      name: 'I',
      summary: null,
      description: null,
      ownerId: null,
      status: 'active',
      priority: 'none',
      updateCadence: 'monthly',
      targetDate: null,
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
      health: null,
      createdAt: 'x',
    });
    expect(parsed.status).toBe('active');
  });
  it('InitiativeOut rejects a bad status', () => {
    expect(
      InitiativeOut.safeParse({
        id: ID,
        organizationId: ID2,
        name: 'I',
        status: 'nope',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('entity display DTOs', () => {
  it('accepts the curated strategic-work icon and semantic color keys', () => {
    expect(EntityDisplaySubjectType.parse('initiative')).toBe('initiative');
    expect(EntityDisplaySubjectType.parse('project')).toBe('project');
    expect(EntityDisplayIconKey.parse('target')).toBe('target');
    expect(EntityDisplayIconKey.parse('bus')).toBe('bus');
    expect(EntityDisplayIconKey.parse('library')).toBe('library');
    expect(EntityDisplayColorKey.parse('primary')).toBe('primary');
    expect(
      EntityDisplayUpdate.parse({ iconKey: 'flag', colorKey: 'warning', customColor: '#ff8800' }),
    ).toEqual({
      iconKey: 'flag',
      colorKey: 'warning',
      customColor: '#ff8800',
    });
  });
  it('rejects uncurated display values and parses a composed display record', () => {
    expect(EntityDisplayIconKey.safeParse('emoji-rocket').success).toBe(false);
    expect(EntityDisplayColorKey.safeParse('#ff00ff').success).toBe(false);
    expect(
      EntityDisplayOut.parse({
        subjectType: 'initiative',
        subjectId: ID,
        iconKey: 'target',
        colorKey: 'neutral',
        customColor: null,
        coverImage: null,
        customized: false,
      }).customized,
    ).toBe(false);
  });
  it('defaults each subject type to its own icon, with no cover until one is uploaded', () => {
    expect(defaultEntityDisplay('initiative', ID)).toEqual({
      subjectType: 'initiative',
      subjectId: ID,
      iconKey: 'target',
      colorKey: 'neutral',
      customColor: null,
      coverImage: null,
      customized: false,
    });
    expect(defaultEntityDisplay('project', ID)).toEqual({
      subjectType: 'project',
      subjectId: ID,
      iconKey: 'folder',
      colorKey: 'neutral',
      customColor: null,
      coverImage: null,
      customized: false,
    });
    // A team's color is hashed from its id rather than defaulted to neutral (see the next test),
    // so this fixed id's expected color is the hash's own deterministic output for it.
    expect(defaultEntityDisplay('team', ID)).toEqual({
      subjectType: 'team',
      subjectId: ID,
      iconKey: 'users',
      colorKey: 'rose',
      customColor: null,
      coverImage: null,
      customized: false,
    });
  });
  it('gives an uncustomized team a stable, varied default color instead of neutral', () => {
    // Stable: the same team always lands on the same color.
    expect(defaultEntityDisplay('team', ID).colorKey).toBe(
      defaultEntityDisplay('team', ID).colorKey,
    );
    // Varied: different teams don't all collapse onto the same color.
    const colors = new Set([ID, ID2, ID3].map((id) => defaultEntityDisplay('team', id).colorKey));
    expect(colors.size).toBeGreaterThan(1);
    // Never a semantic color — those carry meaning elsewhere in the product.
    for (const id of [ID, ID2, ID3]) {
      expect(TEAM_DEFAULT_COLOR_KEYS).toContain(defaultEntityDisplay('team', id).colorKey);
    }
  });
});

describe('program DTOs', () => {
  it('ProgramStatus carries a workspace-defined key, and a Program can complete', () => {
    for (const key of DEFAULT_PROGRAM_STATUS_KEYS) {
      expect(ProgramStatus.parse(key)).toBe(key);
    }
    // The seeded set now includes a way for a Program to end, which the old enum withheld.
    expect(DEFAULT_PROGRAM_STATUS_KEYS).toContain('completed');
    expect(ProgramStatus.safeParse('').success).toBe(false);
  });
  it('ProgramCreate parses minimal + full', () => {
    expect(ProgramCreate.parse({ name: 'P' }).name).toBe('P');
    const full = ProgramCreate.parse({
      name: 'P',
      description: 'd',
      ownerId: ID,
      status: 'paused',
      health: 'off_track',
      visibility: 'private',
    });
    expect(full.visibility).toBe('private');
  });
  it('ProgramCreate rejects empty name', () => {
    expect(ProgramCreate.safeParse({ name: '' }).success).toBe(false);
  });
  it('ProgramUpdate parses nullable + rejects empty name', () => {
    expect(
      ProgramUpdate.parse({ description: null, ownerId: null, health: null }).health,
    ).toBeNull();
    expect(ProgramUpdate.safeParse({ name: '' }).success).toBe(false);
  });
  it('ProgramOut parses and rejects bad visibility', () => {
    expect(
      ProgramOut.parse({
        id: ID,
        organizationId: ID2,
        name: 'P',
        description: null,
        summary: null,
        ownerId: null,
        status: 'active',
        health: null,
        visibility: 'public',
        createdAt: 'x',
      }).visibility,
    ).toBe('public');
    expect(
      ProgramOut.safeParse({
        id: ID,
        organizationId: ID2,
        name: 'P',
        status: 'active',
        visibility: 'nope',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('cycle DTOs', () => {
  it('CycleStatus accepts/rejects', () => {
    for (const s of ['upcoming', 'active', 'completed'] as const) {
      expect(CycleStatus.parse(s)).toBe(s);
    }
    expect(CycleStatus.safeParse('done').success).toBe(false);
  });
  it('CycleCreate parses minimal + full', () => {
    const min = CycleCreate.parse({
      teamId: ID,
      number: 1,
      startsAt: '2026-01-01',
      endsAt: '2026-01-14',
    });
    expect(min.number).toBe(1);
    const full = CycleCreate.parse({
      teamId: ID,
      number: 2,
      name: 'Sprint 2',
      startsAt: '2026-01-01',
      endsAt: '2026-01-14',
      status: 'active',
    });
    expect(full.name).toBe('Sprint 2');
  });
  it('CycleCreate rejects a non-integer number and bad date', () => {
    expect(
      CycleCreate.safeParse({
        teamId: ID,
        number: 1.5,
        startsAt: '2026-01-01',
        endsAt: '2026-01-14',
      }).success,
    ).toBe(false);
    expect(
      CycleCreate.safeParse({ teamId: ID, number: 1, startsAt: 'x', endsAt: '2026-01-14' }).success,
    ).toBe(false);
  });
  it('CycleUpdate parses nullable name + rejects empty name', () => {
    expect(CycleUpdate.parse({ name: null }).name).toBeNull();
    expect(CycleUpdate.safeParse({ name: '' }).success).toBe(false);
  });
  it('CycleCarryoverDecision requires targetCycleId only when action is move', () => {
    expect(CycleCarryoverDecision.safeParse({ taskId: ID, action: 'keep' }).success).toBe(true);
    expect(CycleCarryoverDecision.safeParse({ taskId: ID, action: 'triage' }).success).toBe(true);
    expect(CycleCarryoverDecision.safeParse({ taskId: ID, action: 'move' }).success).toBe(false);
    expect(
      CycleCarryoverDecision.safeParse({ taskId: ID, action: 'move', targetCycleId: ID2 }).success,
    ).toBe(true);
  });
  it('CycleOut parses', () => {
    const parsed = CycleOut.parse({
      id: ID,
      organizationId: ID2,
      teamId: ID,
      number: 1,
      name: null,
      // Required: every read derives it (author name, else the window). See
      // `tests/dto/cycle-display-name.test.ts` for the scheme itself.
      displayName: 'Jul 27 – Aug 2',
      startsAt: 'x',
      endsAt: 'y',
      status: 'active',
      createdAt: 'z',
    });
    expect(parsed.number).toBe(1);
    expect(parsed.displayName).toBe('Jul 27 – Aug 2');
  });
});

describe('milestone DTOs', () => {
  it('MilestoneListQuery parses with and without projectId', () => {
    expect(MilestoneListQuery.parse({}).projectId).toBeUndefined();
    expect(MilestoneListQuery.parse({ projectId: ID }).projectId).toBe(ID);
  });
  it('MilestoneCreate parses + rejects empty name', () => {
    expect(
      MilestoneCreate.parse({ projectId: ID, name: 'M', targetDate: '2026-01-01', sort: 1 }).sort,
    ).toBe(1);
    expect(MilestoneCreate.safeParse({ projectId: ID, name: '' }).success).toBe(false);
  });
  it('MilestoneUpdate parses nullable targetDate + rejects empty name', () => {
    expect(MilestoneUpdate.parse({ targetDate: null }).targetDate).toBeNull();
    expect(MilestoneUpdate.safeParse({ name: '' }).success).toBe(false);
  });
  it('MilestoneOut parses', () => {
    expect(
      MilestoneOut.parse({
        id: ID,
        organizationId: ID2,
        projectId: ID,
        name: 'M',
        description: null,
        targetDate: null,
        sort: 0,
        createdAt: 'x',
      }).sort,
    ).toBe(0);
  });
});

describe('label DTOs', () => {
  it('LabelCreate takes a name alone — color and group are optional', () => {
    const parsed = LabelCreate.parse({ name: 'Bug' });
    expect(parsed.name).toBe('Bug');
    // Omitted so the server can assign by rotation; inline creation depends on this staying
    // optional, since it never asks the user to choose a color.
    expect(parsed.color).toBeUndefined();
    expect(parsed.groupId).toBeUndefined();
  });
  it('LabelCreate has no teamId — a label is always born workspace-wide', () => {
    const parsed = LabelCreate.parse({ name: 'Bug', teamId: ID });
    expect(parsed).not.toHaveProperty('teamId');
  });
  it('LabelCreate rejects a blank or whitespace-only name', () => {
    expect(LabelCreate.safeParse({ name: '' }).success).toBe(false);
    expect(LabelCreate.safeParse({ name: '   ' }).success).toBe(false);
  });
  it('LabelCreate rejects a color outside the palette', () => {
    expect(LabelCreate.safeParse({ name: 'Bug', color: '#f00' }).success).toBe(false);
    expect(LabelCreate.safeParse({ name: 'Bug', color: 'blue' }).success).toBe(true);
  });
  it('LabelUpdate parses nullable group + team scope', () => {
    const parsed = LabelUpdate.parse({ groupId: null, teamId: null });
    expect(parsed.groupId).toBeNull();
    expect(parsed.teamId).toBeNull();
  });
  it('LabelOut parses, and tolerates a legacy hex color from a mirrored label', () => {
    const parsed = LabelOut.parse({
      id: ID,
      organizationId: ID2,
      name: 'Bug',
      color: '#f00',
      groupId: null,
      teamId: null,
      usageCount: 12,
      external: true,
      createdAt: 'x',
    });
    expect(parsed.color).toBe('#f00');
    expect(parsed.usageCount).toBe(12);
    expect(parsed.external).toBe(true);
  });
  it('nextLabelColor rotates deterministically and never assigns the neutral', () => {
    const assigned = Array.from({ length: LABEL_COLOR_KEYS.length + 2 }, (_, i) =>
      nextLabelColor(i),
    );
    expect(assigned).not.toContain('slate');
    // Stable: the nth label in an org is always the same color.
    expect(nextLabelColor(0)).toBe(nextLabelColor(LABEL_COLOR_KEYS.length - 1));
  });
  it('normalizeLabelName folds case and collapses whitespace', () => {
    expect(normalizeLabelName('  Needs   Triage ')).toBe('needs triage');
    expect(normalizeLabelName('Bug')).toBe(normalizeLabelName('bug'));
  });
  it('LabelGroup DTOs default to exclusive', () => {
    expect(LabelGroupCreate.parse({ name: 'Type' }).exclusive).toBeUndefined();
    const out = LabelGroupOut.parse({
      id: ID,
      organizationId: ID2,
      name: 'Type',
      exclusive: true,
      sortOrder: 0,
      teamId: null,
      createdAt: 'x',
    });
    expect(out.exclusive).toBe(true);
  });
  it('LabelMerge requires a target', () => {
    expect(LabelMerge.safeParse({}).success).toBe(false);
    expect(LabelMerge.parse({ intoId: ID }).intoId).toBe(ID);
  });
});

describe('comment DTOs', () => {
  it('CommentSubjectType accepts/rejects', () => {
    for (const t of ['task', 'project', 'program', 'initiative', 'cycle'] as const) {
      expect(CommentSubjectType.parse(t)).toBe(t);
    }
    expect(CommentSubjectType.safeParse('milestone').success).toBe(false);
  });
  it('CommentListQuery parses + rejects empty subjectId', () => {
    expect(CommentListQuery.parse({ subjectType: 'task', subjectId: ID }).subjectId).toBe(ID);
    expect(CommentListQuery.safeParse({ subjectType: 'task', subjectId: '' }).success).toBe(false);
  });
  it('CommentCreate parses + rejects empty body', () => {
    expect(
      CommentCreate.parse({ subjectType: 'task', subjectId: ID, body: 'hi', parentCommentId: ID2 })
        .parentCommentId,
    ).toBe(ID2);
    expect(CommentCreate.safeParse({ subjectType: 'task', subjectId: ID, body: '' }).success).toBe(
      false,
    );
  });
  it('CommentUpdate parses + rejects empty body', () => {
    expect(CommentUpdate.parse({ body: 'edited' }).body).toBe('edited');
    expect(CommentUpdate.safeParse({ body: '' }).success).toBe(false);
  });
  it('CommentOut parses', () => {
    expect(
      CommentOut.parse({
        id: ID,
        organizationId: ID2,
        authorId: null,
        subjectType: 'task',
        subjectId: ID,
        body: 'hi',
        parentCommentId: null,
        editedAt: null,
        createdAt: 'x',
      }).body,
    ).toBe('hi');
  });
});

describe('update DTOs', () => {
  it('UpdateSubjectType accepts/rejects', () => {
    for (const t of ['project', 'program', 'initiative'] as const) {
      expect(UpdateSubjectType.parse(t)).toBe(t);
    }
    expect(UpdateSubjectType.safeParse('task').success).toBe(false);
  });
  it('UpdateListQuery parses + rejects empty subjectId', () => {
    expect(UpdateListQuery.parse({ subjectType: 'project', subjectId: ID }).subjectType).toBe(
      'project',
    );
    expect(UpdateListQuery.safeParse({ subjectType: 'project', subjectId: '' }).success).toBe(
      false,
    );
  });
  it('UpdateCreate parses + rejects empty body', () => {
    expect(
      UpdateCreate.parse({ subjectType: 'project', subjectId: ID, health: 'on_track', body: 'b' })
        .health,
    ).toBe('on_track');
    expect(
      UpdateCreate.safeParse({ subjectType: 'project', subjectId: ID, body: '' }).success,
    ).toBe(false);
  });
  it('UpdateOut parses', () => {
    expect(
      UpdateOut.parse({
        id: ID,
        organizationId: ID2,
        authorId: null,
        subjectType: 'project',
        subjectId: ID,
        health: null,
        body: 'b',
        createdAt: 'x',
      }).body,
    ).toBe('b');
  });
});

describe('saved-view DTOs', () => {
  it('ViewScope accepts/rejects', () => {
    for (const s of ['personal', 'team', 'organization'] as const) {
      expect(ViewScope.parse(s)).toBe(s);
    }
    expect(ViewScope.safeParse('global').success).toBe(false);
  });
  it('ViewFilter parses each op + rejects bad op', () => {
    expect(ViewFilter.parse({ field: 'state', op: 'eq', value: 'todo' }).op).toBe('eq');
    expect(ViewFilter.parse({ field: 'x', op: 'in', value: [1, 2] }).value).toEqual([1, 2]);
    expect(ViewFilter.safeParse({ field: 'x', op: 'between', value: 1 }).success).toBe(false);
  });
  it('ViewGrouping parses with + without subBy', () => {
    expect(ViewGrouping.parse({ by: 'state' }).subBy).toBeUndefined();
    expect(ViewGrouping.parse({ by: 'state', subBy: 'assignee' }).subBy).toBe('assignee');
  });
  it('ViewSort parses + rejects bad order', () => {
    expect(ViewSort.parse({ field: 'createdAt', order: 'asc' }).order).toBe('asc');
    expect(ViewSort.safeParse({ field: 'x', order: 'random' }).success).toBe(false);
  });
  it('SavedViewCreate parses minimal + full', () => {
    expect(SavedViewCreate.parse({ name: 'V' }).name).toBe('V');
    const full = SavedViewCreate.parse({
      name: 'V',
      scope: 'team',
      ownerActorId: ID,
      teamId: ID2,
      filters: [{ field: 'state', op: 'eq', value: 'todo' }],
      grouping: { by: 'state' },
      sort: [{ field: 'createdAt', order: 'desc' }],
    });
    expect(full.filters).toHaveLength(1);
  });
  it('SavedViewCreate rejects empty name', () => {
    expect(SavedViewCreate.safeParse({ name: '' }).success).toBe(false);
  });
  it('SavedViewUpdate parses nullable grouping/teamId', () => {
    expect(
      SavedViewUpdate.parse({ grouping: null, teamId: null, ownerActorId: null }).grouping,
    ).toBeNull();
  });
  it('SavedViewOut parses', () => {
    const parsed = SavedViewOut.parse({
      id: ID,
      organizationId: ID2,
      name: 'V',
      scope: 'personal',
      ownerActorId: null,
      teamId: null,
      filters: [],
      grouping: null,
      sort: [],
      createdAt: 'x',
    });
    expect(parsed.scope).toBe('personal');
  });
});

describe('TaskDependencyCreate DTO', () => {
  it('accepts exactly one of blockingTaskId / blockedTaskId', () => {
    expect(TaskDependencyCreate.safeParse({ blockingTaskId: ID }).success).toBe(true);
    expect(TaskDependencyCreate.safeParse({ blockedTaskId: ID }).success).toBe(true);
  });
  it('rejects providing both endpoints or neither (exactly-one refine)', () => {
    expect(TaskDependencyCreate.safeParse({ blockingTaskId: ID, blockedTaskId: ID2 }).success).toBe(
      false,
    );
    expect(TaskDependencyCreate.safeParse({}).success).toBe(false);
  });
});
