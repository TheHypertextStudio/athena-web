import { describe, expect, it } from 'vitest';

import { ActorOut } from '../src/actor';
import { AuditEventOut, AuditEventType, AuditSubjectType } from '../src/activity';
import { AgendaOut, AgendaQuery, CalendarAgendaEventOut } from '../src/agenda';
import {
  AgentConnection,
  AgentCreate,
  AgentOut,
  AgentProtocol,
  AgentSessionDetailOut,
  AgentSessionOut,
  AgentUpdate,
  ApprovalPolicy,
  ApprovalRouting,
  ApprovalStatus,
  SessionActivityOut,
  SessionActivityType,
  SessionStatus,
  SessionTrigger,
} from '../src/agent';
import { AttachmentCreate, AttachmentSubjectType } from '../src/attachment';
import {
  CalendarConnectionOut,
  CalendarEventCreateTask,
  CalendarEventOut,
  CalendarListOut,
  CalendarSyncResultOut,
} from '../src/calendar';
import {
  CommentCreate,
  CommentListQuery,
  CommentOut,
  CommentSubjectType,
  CommentUpdate,
} from '../src/comment';
import {
  CycleCarryoverDecision,
  CycleCreate,
  CycleOut,
  CycleStatus,
  CycleUpdate,
} from '../src/cycle';
import {
  DailyPlanItemCreate,
  DailyPlanItemOut,
  DailyPlanItemStatus,
  DailyPlanItemUpdate,
} from '../src/daily-plan';
import { GrantOut, GrantResourceKind, GrantSubjectKind, GrantUpsert } from '../src/grant';
import {
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  EntityDisplaySubjectType,
  EntityDisplayUpdate,
} from '../src/entity-display';
import {
  HubActivityOut,
  HubInboxOut,
  HubPortfolioOut,
  HubProjectItem,
  HubSearchOut,
  HubTaskItem,
  HubTodayOut,
} from '../src/hub';
import {
  InitiativeCreate,
  InitiativeHierarchyLinkCreate,
  InitiativeHierarchyLinkMove,
  InitiativeHierarchyLinkOut,
  InitiativeOut,
  InitiativeStatus,
  InitiativeUpdate,
} from '../src/initiative';
import {
  IntegrationConnection,
  IntegrationCreate,
  IntegrationOut,
  IntegrationPattern,
  IntegrationRole,
  IntegrationStatus,
  IntegrationUpdate,
  SyncMode,
} from '../src/integration';
import { LabelCreate, LabelOut, LabelUpdate } from '../src/label';
import {
  InvitationAccept,
  InvitationOut,
  MemberInvite,
  MemberOut,
  MemberUpdate,
} from '../src/member';
import {
  MilestoneCreate,
  MilestoneListQuery,
  MilestoneOut,
  MilestoneUpdate,
} from '../src/milestone';
import { NotificationBody, NotificationOut, NotificationType } from '../src/notification';
import {
  DailyDigestOut,
  DailyDigestStatus,
  EventKind,
  EventOut,
  InboundEventOut,
  InboundEventStatus,
} from '../src/event';
import {
  DefaultTeamOut,
  OrgCreate,
  OrgCreateResult,
  OrgOut,
  OrgSummary,
  OrgUpdate,
  WorkspaceSettingsOut,
  WorkspaceSettingsUpdate,
} from '../src/organization';
import { ProgramCreate, ProgramOut, ProgramStatus, ProgramUpdate } from '../src/program';
import { ProjectCreate, ProjectOut } from '../src/project';
import { RoleCreate, RoleOut, RoleUpdate } from '../src/role';
import {
  SavedViewCreate,
  SavedViewOut,
  SavedViewUpdate,
  ViewFilter,
  ViewGrouping,
  ViewScope,
  ViewSort,
} from '../src/saved-view';
import { TaskCreate, TaskDependencyCreate, TaskOut, TaskProvenance, TaskUpdate } from '../src/task';
import { TeamOut } from '../src/team';
import { UpdateCreate, UpdateListQuery, UpdateOut, UpdateSubjectType } from '../src/update';

/** A canonical valid 26-char Crockford ULID, reused across DTO fixtures. */
const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
/** A second distinct valid ULID. */
const ID2 = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
/** A third distinct valid ULID. */
const ID3 = '01BX5ZZKBKACTAV9WEVGEMMVS0';

describe('organization DTOs', () => {
  it('OrgCreate applies defaults and parses', () => {
    const parsed = OrgCreate.parse({ name: 'Acme' });
    expect(parsed.vocabulary).toBe('startup');
    expect(parsed.isPersonal).toBe(false);
  });

  it('OrgCreate parses with slug + intent', () => {
    const parsed = OrgCreate.parse({ name: 'Acme', slug: 'acme', intent: 'nonprofit' });
    expect(parsed.slug).toBe('acme');
    expect(parsed.intent).toBe('nonprofit');
  });

  it('OrgCreate rejects an empty name', () => {
    expect(OrgCreate.safeParse({ name: '' }).success).toBe(false);
  });

  it('OrgCreate accepts a personal space without a name', () => {
    const parsed = OrgCreate.parse({ isPersonal: true });
    expect(parsed.isPersonal).toBe(true);
    expect(parsed.name).toBeUndefined();
  });

  it('OrgCreate accepts a personal space with an explicit name', () => {
    const parsed = OrgCreate.parse({ name: 'My Space', isPersonal: true });
    expect(parsed.name).toBe('My Space');
  });

  it('OrgCreate requires a name for a team org (isPersonal false)', () => {
    const result = OrgCreate.safeParse({ isPersonal: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'name')).toBe(true);
    }
  });

  it('OrgCreate (default, no isPersonal) still requires a name', () => {
    expect(OrgCreate.safeParse({}).success).toBe(false);
  });

  it('OrgUpdate accepts every safe editable workspace attribute', () => {
    expect(
      OrgUpdate.parse({
        name: 'Operations',
        purpose: 'Run the company with less coordination overhead.',
        slug: 'operations',
        avatar: 'https://example.com/logo.png',
        vocabulary: 'agency',
      }),
    ).toEqual({
      name: 'Operations',
      purpose: 'Run the company with less coordination overhead.',
      slug: 'operations',
      avatar: 'https://example.com/logo.png',
      vocabulary: 'agency',
    });
  });

  it('OrgUpdate supports clearing optional attributes and rejects invalid basics', () => {
    expect(OrgUpdate.parse({ purpose: null, avatar: null })).toEqual({
      purpose: null,
      avatar: null,
    });
    expect(OrgUpdate.safeParse({ name: '' }).success).toBe(false);
    expect(OrgUpdate.safeParse({ slug: 'Not URL Safe' }).success).toBe(false);
    expect(OrgUpdate.safeParse({ avatar: 'not-a-url' }).success).toBe(false);
    expect(OrgUpdate.safeParse({}).success).toBe(false);
    expect(OrgUpdate.safeParse({ avatar: 'data:image/png;base64,aGVsbG8=' }).success).toBe(true);
    expect(
      OrgUpdate.safeParse({ avatar: `data:image/png;base64,${'a'.repeat(1_500_000)}` }).success,
    ).toBe(false);
  });

  it('OrgOut parses a full org', () => {
    const parsed = OrgOut.parse({
      id: ID,
      name: 'Acme',
      slug: 'acme',
      avatar: null,
      isPersonal: false,
      vocabulary: { preset: 'startup' },
      lifecycleState: 'active',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(parsed.id).toBe(ID);
  });

  it('OrgOut rejects a bad id', () => {
    expect(
      OrgOut.safeParse({
        id: 'bad',
        name: 'A',
        slug: 'a',
        isPersonal: false,
        vocabulary: { preset: 'startup' },
        lifecycleState: 'active',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('OrgSummary parses', () => {
    expect(OrgSummary.parse({ id: ID, name: 'A', slug: 'a', isPersonal: true }).isPersonal).toBe(
      true,
    );
  });

  it('OrgSummary rejects a missing name', () => {
    expect(OrgSummary.safeParse({ id: ID, slug: 'a', isPersonal: true }).success).toBe(false);
  });

  it('DefaultTeamOut parses and rejects bad id', () => {
    expect(DefaultTeamOut.parse({ id: ID, name: 'Default', key: 'DEF' }).key).toBe('DEF');
    expect(DefaultTeamOut.safeParse({ id: 'bad', name: 'D', key: 'D' }).success).toBe(false);
  });

  it('OrgCreateResult parses a nested result and rejects a bad nested org', () => {
    const parsed = OrgCreateResult.parse({
      organization: {
        id: ID,
        name: 'Acme',
        slug: 'acme',
        isPersonal: false,
        vocabulary: { preset: 'startup' },
        lifecycleState: 'active',
        createdAt: 'x',
      },
      defaultTeam: { id: ID2, name: 'Default', key: 'DEF' },
      ownerActorId: ID,
    });
    expect(parsed.ownerActorId).toBe(ID);
    expect(
      OrgCreateResult.safeParse({ organization: {}, defaultTeam: {}, ownerActorId: ID }).success,
    ).toBe(false);
  });
});

describe('project DTOs', () => {
  it('ProjectCreate parses minimal and full', () => {
    expect(ProjectCreate.parse({ name: 'P' }).name).toBe('P');
    const full = ProjectCreate.parse({
      name: 'P',
      description: 'd',
      leadId: ID,
      teamId: ID2,
      startDate: '2026-01-01',
      targetDate: '2026-02-01',
      initiativeIds: [ID],
    });
    expect(full.initiativeIds).toEqual([ID]);
  });

  it('ProjectCreate rejects empty name and bad date', () => {
    expect(ProjectCreate.safeParse({ name: '' }).success).toBe(false);
    expect(ProjectCreate.safeParse({ name: 'P', startDate: 'nope' }).success).toBe(false);
  });

  it('ProjectOut parses with nullable fields', () => {
    const parsed = ProjectOut.parse({
      id: ID,
      organizationId: ID2,
      name: 'P',
      description: null,
      status: 'started',
      health: 'on_track',
      leadId: null,
      teamId: null,
      programId: null,
      startDate: null,
      targetDate: null,
      createdAt: 'x',
    });
    expect(parsed.health).toBe('on_track');
  });

  it('ProjectOut rejects a bad health enum', () => {
    expect(
      ProjectOut.safeParse({
        id: ID,
        organizationId: ID2,
        name: 'P',
        status: 's',
        health: 'nope',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('task DTOs', () => {
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
      id: ID,
      organizationId: ID2,
      title: 'T',
      description: null,
      teamId: ID,
      state: 'todo',
      priority: 'none',
      assigneeId: null,
      delegateId: null,
      projectId: null,
      programId: null,
      startDate: null,
      dueDate: null,
      provenance: { source: 'native' },
      createdAt: 'x',
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
});

describe('actor + team DTOs', () => {
  it('ActorOut parses each kind/status and rejects bad kind', () => {
    const parsed = ActorOut.parse({
      id: ID,
      organizationId: ID2,
      kind: 'agent',
      displayName: 'Bot',
      avatar: null,
      status: 'active',
      roleId: null,
    });
    expect(parsed.kind).toBe('agent');
    expect(
      ActorOut.safeParse({
        id: ID,
        organizationId: ID2,
        kind: 'robot',
        displayName: 'x',
        status: 'active',
      }).success,
    ).toBe(false);
    expect(
      ActorOut.safeParse({
        id: ID,
        organizationId: ID2,
        kind: 'human',
        displayName: 'x',
        status: 'gone',
      }).success,
    ).toBe(false);
  });

  it('TeamOut parses and rejects a missing triageEnabled', () => {
    expect(
      TeamOut.parse({ id: ID, organizationId: ID2, name: 'Eng', key: 'ENG', triageEnabled: true })
        .triageEnabled,
    ).toBe(true);
    expect(
      TeamOut.safeParse({ id: ID, organizationId: ID2, name: 'Eng', key: 'ENG' }).success,
    ).toBe(false);
  });
});

describe('initiative DTOs', () => {
  it('InitiativeStatus accepts/rejects', () => {
    expect(InitiativeStatus.parse('proposed')).toBe('proposed');
    expect(InitiativeStatus.parse('completed')).toBe('completed');
    expect(InitiativeStatus.parse('canceled')).toBe('canceled');
    expect(InitiativeStatus.safeParse('paused').success).toBe(false);
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
      description: null,
      ownerId: null,
      targetDate: null,
      health: null,
    });
    expect(parsed.description).toBeNull();
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
        customized: false,
      }).customized,
    ).toBe(false);
  });
});

describe('workspace settings DTOs', () => {
  it('accepts Initiative maximum depths from one through five', () => {
    expect(WorkspaceSettingsOut.parse({ initiativeMaxDepth: 2 }).initiativeMaxDepth).toBe(2);
    expect(WorkspaceSettingsUpdate.parse({ initiativeMaxDepth: 1 }).initiativeMaxDepth).toBe(1);
    expect(WorkspaceSettingsUpdate.parse({ initiativeMaxDepth: 5 }).initiativeMaxDepth).toBe(5);
  });

  it('rejects Initiative maximum depths outside one through five', () => {
    expect(WorkspaceSettingsUpdate.safeParse({ initiativeMaxDepth: 0 }).success).toBe(false);
    expect(WorkspaceSettingsUpdate.safeParse({ initiativeMaxDepth: 6 }).success).toBe(false);
  });
});

describe('program DTOs', () => {
  it('ProgramStatus accepts/rejects', () => {
    for (const s of ['active', 'paused', 'archived'] as const) {
      expect(ProgramStatus.parse(s)).toBe(s);
    }
    expect(ProgramStatus.safeParse('completed').success).toBe(false);
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
      startsAt: 'x',
      endsAt: 'y',
      status: 'active',
      createdAt: 'z',
    });
    expect(parsed.number).toBe(1);
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
        targetDate: null,
        sort: 0,
        createdAt: 'x',
      }).sort,
    ).toBe(0);
  });
});

describe('label DTOs', () => {
  it('LabelCreate parses org-global + team-scoped', () => {
    expect(LabelCreate.parse({ name: 'Bug', color: '#f00' }).teamId).toBeUndefined();
    expect(
      LabelCreate.parse({ name: 'Bug', color: '#f00', group: 'type', teamId: ID }).teamId,
    ).toBe(ID);
  });

  it('LabelCreate rejects empty name + empty color', () => {
    expect(LabelCreate.safeParse({ name: '', color: '#f00' }).success).toBe(false);
    expect(LabelCreate.safeParse({ name: 'Bug', color: '' }).success).toBe(false);
  });

  it('LabelUpdate parses nullable fields', () => {
    expect(LabelUpdate.parse({ group: null, teamId: null }).group).toBeNull();
  });

  it('LabelOut parses', () => {
    expect(
      LabelOut.parse({
        id: ID,
        organizationId: ID2,
        name: 'Bug',
        color: '#f00',
        group: null,
        teamId: null,
        createdAt: 'x',
      }).color,
    ).toBe('#f00');
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

describe('member + invitation DTOs', () => {
  it('MemberOut parses + rejects bad status', () => {
    expect(
      MemberOut.parse({
        actorId: ID,
        organizationId: ID2,
        displayName: 'Alice',
        avatar: null,
        status: 'active',
        roleId: null,
        userId: null,
        createdAt: 'x',
      }).status,
    ).toBe('active');
    expect(
      MemberOut.safeParse({
        actorId: ID,
        organizationId: ID2,
        displayName: 'A',
        status: 'banned',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('MemberInvite parses + rejects bad email', () => {
    expect(MemberInvite.parse({ email: 'a@b.com', roleId: ID, asGuest: true }).asGuest).toBe(true);
    expect(MemberInvite.safeParse({ email: 'not-email', roleId: ID }).success).toBe(false);
  });

  it('MemberUpdate parses + rejects bad status', () => {
    expect(MemberUpdate.parse({ roleId: ID, status: 'suspended' }).status).toBe('suspended');
    expect(MemberUpdate.safeParse({ status: 'frozen' }).success).toBe(false);
  });

  it('InvitationAccept parses + rejects empty token', () => {
    expect(InvitationAccept.parse({ token: 't' }).token).toBe('t');
    expect(InvitationAccept.safeParse({ token: '' }).success).toBe(false);
  });

  it('InvitationOut parses + rejects bad status', () => {
    expect(
      InvitationOut.parse({
        id: ID,
        organizationId: ID2,
        email: 'a@b.com',
        roleId: ID,
        asGuest: false,
        status: 'pending',
        invitedBy: null,
        expiresAt: 'x',
        createdAt: 'y',
        acceptedAt: null,
      }).status,
    ).toBe('pending');
    expect(
      InvitationOut.safeParse({
        id: ID,
        organizationId: ID2,
        email: 'a@b.com',
        roleId: ID,
        asGuest: false,
        status: 'unknown',
        expiresAt: 'x',
        createdAt: 'y',
      }).success,
    ).toBe(false);
  });
});

describe('role DTOs', () => {
  it('RoleCreate parses minimal + full', () => {
    expect(RoleCreate.parse({ key: 'lead', name: 'Lead' }).key).toBe('lead');
    const full = RoleCreate.parse({
      key: 'lead',
      name: 'Lead',
      capabilities: ['manage', 'assign'],
      baseCapability: 'contribute',
      defaultVisibility: 'private',
    });
    expect(full.capabilities).toEqual(['manage', 'assign']);
  });

  it('RoleCreate rejects empty key + bad capability', () => {
    expect(RoleCreate.safeParse({ key: '', name: 'L' }).success).toBe(false);
    expect(RoleCreate.safeParse({ key: 'l', name: 'L', capabilities: ['superuser'] }).success).toBe(
      false,
    );
  });

  it('RoleUpdate parses nullable baseCapability', () => {
    expect(RoleUpdate.parse({ baseCapability: null }).baseCapability).toBeNull();
  });

  it('RoleOut parses', () => {
    const parsed = RoleOut.parse({
      id: ID,
      organizationId: ID2,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      capabilities: ['manage'],
      baseCapability: 'manage',
      defaultVisibility: 'public',
      createdAt: 'x',
    });
    expect(parsed.isSystem).toBe(true);
  });
});

describe('grant DTOs', () => {
  it('GrantSubjectKind + GrantResourceKind accept/reject', () => {
    expect(GrantSubjectKind.parse('actor')).toBe('actor');
    expect(GrantSubjectKind.safeParse('group').success).toBe(false);
    for (const r of [
      'organization',
      'team',
      'initiative',
      'program',
      'project',
      'cycle',
      'task',
    ] as const) {
      expect(GrantResourceKind.parse(r)).toBe(r);
    }
    expect(GrantResourceKind.safeParse('milestone').success).toBe(false);
  });

  it('GrantUpsert parses minimal + full', () => {
    const min = GrantUpsert.parse({
      subjectKind: 'actor',
      subjectId: ID,
      resourceKind: 'project',
      resourceId: ID2,
      capabilities: ['view'],
    });
    expect(min.capabilities).toEqual(['view']);
    const full = GrantUpsert.parse({
      subjectKind: 'role',
      subjectId: ID,
      resourceKind: 'task',
      resourceId: ID2,
      capabilities: ['manage'],
      cascades: true,
      visibilityOverride: 'private',
      visibility: 'public',
      expiresAt: '2026-01-01T00:00:00Z',
    });
    expect(full.cascades).toBe(true);
  });

  it('GrantUpsert rejects empty subjectId + bad datetime', () => {
    expect(
      GrantUpsert.safeParse({
        subjectKind: 'actor',
        subjectId: '',
        resourceKind: 'task',
        resourceId: ID,
        capabilities: [],
      }).success,
    ).toBe(false);
    expect(
      GrantUpsert.safeParse({
        subjectKind: 'actor',
        subjectId: ID,
        resourceKind: 'task',
        resourceId: ID2,
        capabilities: [],
        expiresAt: 'not-a-datetime',
      }).success,
    ).toBe(false);
  });

  it('GrantOut parses both effects + rejects bad effect', () => {
    const parsed = GrantOut.parse({
      id: ID,
      organizationId: ID2,
      subjectKind: 'actor',
      subjectId: ID,
      resourceKind: 'project',
      resourceId: ID2,
      capabilities: ['view'],
      effect: 'deny',
      cascades: false,
      visibilityOverride: null,
      visibility: 'private',
      expiresAt: null,
      createdAt: 'x',
    });
    expect(parsed.effect).toBe('deny');
    expect(
      GrantOut.safeParse({
        id: ID,
        organizationId: ID2,
        subjectKind: 'actor',
        subjectId: ID,
        resourceKind: 'project',
        resourceId: ID2,
        capabilities: [],
        effect: 'maybe',
        cascades: false,
        visibility: 'private',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('agent DTOs', () => {
  it('ApprovalPolicy / AgentProtocol / SessionStatus / SessionTrigger / SessionActivityType / ApprovalStatus accept/reject', () => {
    expect(ApprovalPolicy.parse('autonomous')).toBe('autonomous');
    expect(ApprovalPolicy.safeParse('manual').success).toBe(false);
    expect(AgentProtocol.parse('mcp')).toBe('mcp');
    expect(AgentProtocol.safeParse('grpc').success).toBe(false);
    for (const s of [
      'pending',
      'running',
      'awaiting_input',
      'awaiting_approval',
      'completed',
      'failed',
      'canceled',
    ] as const) {
      expect(SessionStatus.parse(s)).toBe(s);
    }
    expect(SessionStatus.safeParse('paused').success).toBe(false);
    expect(SessionTrigger.parse('mention')).toBe('mention');
    expect(SessionTrigger.safeParse('cron').success).toBe(false);
    for (const t of ['thought', 'action', 'response', 'elicitation', 'error'] as const) {
      expect(SessionActivityType.parse(t)).toBe(t);
    }
    expect(SessionActivityType.safeParse('log').success).toBe(false);
    for (const a of ['proposed', 'approved', 'rejected', 'applied'] as const) {
      expect(ApprovalStatus.parse(a)).toBe(a);
    }
    expect(ApprovalStatus.safeParse('pending').success).toBe(false);
  });

  it('AgentConnection parses + rejects missing endpoint', () => {
    expect(
      AgentConnection.parse({ endpoint: 'http://x', protocol: 'mcp', credentialsRef: 'ref' })
        .protocol,
    ).toBe('mcp');
    expect(AgentConnection.safeParse({ protocol: 'mcp' }).success).toBe(false);
  });

  it('ApprovalRouting parses each mode + rejects bad mode', () => {
    expect(ApprovalRouting.parse({ mode: 'assigner' }).mode).toBe('assigner');
    expect(ApprovalRouting.parse({ mode: 'fixed', approverActorId: ID }).approverActorId).toBe(ID);
    expect(ApprovalRouting.parse({ mode: 'role', approverRoleId: ID }).approverRoleId).toBe(ID);
    expect(ApprovalRouting.safeParse({ mode: 'auto' }).success).toBe(false);
  });

  it('AgentCreate parses (actorId or displayName) + rejects empty displayName', () => {
    expect(AgentCreate.parse({ actorId: ID }).actorId).toBe(ID);
    const full = AgentCreate.parse({
      displayName: 'Bot',
      connection: { endpoint: 'http://x', protocol: 'webhook' },
      approvalPolicy: 'suggest',
      accountableOwnerId: ID,
      guidance: 'g',
      approvalRouting: { mode: 'assigner' },
    });
    expect(full.displayName).toBe('Bot');
    expect(
      AgentCreate.parse({ displayName: 'Bot', connection: null, accountableOwnerId: null })
        .connection,
    ).toBeNull();
    expect(AgentCreate.safeParse({ displayName: '' }).success).toBe(false);
  });

  it('AgentUpdate parses nullable fields', () => {
    expect(
      AgentUpdate.parse({
        connection: null,
        accountableOwnerId: null,
        guidance: null,
        approvalRouting: null,
      }).guidance,
    ).toBeNull();
  });

  it('AgentOut parses + rejects missing actorId', () => {
    const parsed = AgentOut.parse({
      id: ID,
      organizationId: ID2,
      actorId: ID,
      connection: null,
      approvalPolicy: 'autonomous',
      accountableOwnerId: null,
      guidance: null,
      approvalRouting: null,
      createdAt: 'x',
    });
    expect(parsed.approvalPolicy).toBe('autonomous');
    expect(
      AgentOut.safeParse({
        id: ID,
        organizationId: ID2,
        approvalPolicy: 'autonomous',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('SessionActivityOut parses + rejects bad type', () => {
    const parsed = SessionActivityOut.parse({
      id: ID,
      sessionId: ID2,
      organizationId: ID,
      type: 'thought',
      body: { text: 'thinking' },
      approvalStatus: null,
      createdAt: 'x',
    });
    expect(parsed.type).toBe('thought');
    expect(
      SessionActivityOut.safeParse({
        id: ID,
        sessionId: ID2,
        organizationId: ID,
        type: 'log',
        body: {},
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('AgentSessionOut parses', () => {
    expect(
      AgentSessionOut.parse({
        id: ID,
        organizationId: ID2,
        agentId: ID,
        taskId: null,
        trigger: 'assignment',
        status: 'pending',
        initiatorId: null,
        externalRunRef: null,
        startedAt: null,
        endedAt: null,
        createdAt: 'x',
      }).trigger,
    ).toBe('assignment');
  });

  it('AgentSessionDetailOut parses with activities + rejects bad activity', () => {
    const parsed = AgentSessionDetailOut.parse({
      id: ID,
      organizationId: ID2,
      agentId: ID,
      taskId: ID2,
      trigger: 'delegation',
      status: 'running',
      initiatorId: ID,
      externalRunRef: 'run',
      startedAt: 'x',
      endedAt: null,
      createdAt: 'y',
      activities: [
        {
          id: ID,
          sessionId: ID2,
          organizationId: ID,
          type: 'action',
          body: {},
          approvalStatus: 'proposed',
          createdAt: 'z',
        },
      ],
    });
    expect(parsed.activities).toHaveLength(1);
    expect(
      AgentSessionDetailOut.safeParse({
        id: ID,
        organizationId: ID2,
        agentId: ID,
        trigger: 'mention',
        status: 'running',
        createdAt: 'y',
        activities: [
          { id: ID, sessionId: ID2, organizationId: ID, type: 'bogus', body: {}, createdAt: 'z' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('integration DTOs', () => {
  it('IntegrationPattern / IntegrationRole / IntegrationStatus / SyncMode accept/reject', () => {
    expect(IntegrationPattern.parse('connector')).toBe('connector');
    expect(IntegrationPattern.safeParse('bridge').success).toBe(false);
    for (const r of ['work', 'context', 'signal', 'time', 'code'] as const) {
      expect(IntegrationRole.parse(r)).toBe(r);
    }
    expect(IntegrationRole.safeParse('billing').success).toBe(false);
    for (const s of ['pending', 'connected', 'error', 'disconnected'] as const) {
      expect(IntegrationStatus.parse(s)).toBe(s);
    }
    expect(IntegrationStatus.safeParse('paused').success).toBe(false);
    expect(SyncMode.parse('mirror')).toBe('mirror');
    expect(SyncMode.safeParse('push').success).toBe(false);
  });

  it('IntegrationConnection parses (all optional)', () => {
    expect(IntegrationConnection.parse({}).account).toBeUndefined();
    expect(
      IntegrationConnection.parse({ account: 'a', credentialsRef: 'r', externalWorkspaceId: 'w' })
        .account,
    ).toBe('a');
  });

  it('IntegrationCreate parses minimal + full', () => {
    expect(IntegrationCreate.parse({ provider: 'github', pattern: 'connector' }).provider).toBe(
      'github',
    );
    const full = IntegrationCreate.parse({
      provider: 'github',
      pattern: 'migration',
      roles: ['work', 'code'],
      connection: { externalWorkspaceId: 'client-must-not-set-this' },
      config: { repo: 'x' },
      syncMode: 'import',
    });
    expect(full.roles).toEqual(['work', 'code']);
    expect('connection' in full).toBe(false);
  });

  it('IntegrationCreate rejects empty provider + bad pattern', () => {
    expect(IntegrationCreate.safeParse({ provider: '', pattern: 'connector' }).success).toBe(false);
    expect(IntegrationCreate.safeParse({ provider: 'x', pattern: 'bad' }).success).toBe(false);
  });

  it('IntegrationUpdate parses (and never accepts client-set status)', () => {
    expect(IntegrationUpdate.parse({ roles: ['work'], config: {} }).roles).toEqual(['work']);
    // `status` is intentionally not part of the schema; a client cannot declare health.
    expect('status' in IntegrationUpdate.parse({ config: {} })).toBe(false);
    expect(
      'connection' in
        IntegrationUpdate.parse({ connection: { externalWorkspaceId: 'client-controlled' } }),
    ).toBe(false);
  });

  it('IntegrationOut parses + rejects missing connection', () => {
    const parsed = IntegrationOut.parse({
      id: ID,
      organizationId: ID2,
      provider: 'github',
      pattern: 'connector',
      roles: ['work'],
      connection: {},
      status: 'connected',
      config: {},
      externalAccountId: null,
      syncMode: 'mirror',
      writeBack: false,
      lastSyncStatus: null,
      lastSyncedAt: null,
      lastError: null,
      lastErrorAt: null,
      syncCadenceMinutes: 60,
      createdAt: 'x',
    });
    expect(parsed.syncMode).toBe('mirror');
    expect(
      IntegrationOut.safeParse({
        id: ID,
        organizationId: ID2,
        provider: 'g',
        pattern: 'connector',
        roles: [],
        status: 'connected',
        config: {},
        syncMode: 'mirror',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('notification DTOs', () => {
  it('NotificationType accepts/rejects', () => {
    for (const t of [
      'mention',
      'assignment',
      'approval_request',
      'status_change',
      'comment',
      'invitation',
      'agent_session',
    ] as const) {
      expect(NotificationType.parse(t)).toBe(t);
    }
    expect(NotificationType.safeParse('newsletter').success).toBe(false);
  });

  it('NotificationBody parses + keeps unknown keys (loose) + rejects missing title', () => {
    const parsed = NotificationBody.parse({ title: 'T', summary: 's', url: 'u', extra: 'kept' });
    expect((parsed as Record<string, unknown>)['extra']).toBe('kept');
    expect(NotificationBody.safeParse({ summary: 's' }).success).toBe(false);
  });

  it('NotificationOut parses + rejects bad type', () => {
    const parsed = NotificationOut.parse({
      id: ID,
      userId: 'user-1',
      organizationId: null,
      type: 'mention',
      body: { title: 'T' },
      readAt: null,
      createdAt: 'x',
    });
    expect(parsed.type).toBe('mention');
    expect(
      NotificationOut.safeParse({
        id: ID,
        userId: 'u',
        type: 'spam',
        body: { title: 'T' },
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('daily-plan DTOs', () => {
  it('DailyPlanItemStatus accepts/rejects', () => {
    expect(DailyPlanItemStatus.parse('done')).toBe('done');
    expect(DailyPlanItemStatus.safeParse('skipped').success).toBe(false);
  });

  it('DailyPlanItemCreate parses minimal + full', () => {
    const min = DailyPlanItemCreate.parse({
      refOrganizationId: ID,
      refTaskId: ID2,
      date: '2026-01-01',
    });
    expect(min.refTaskId).toBe(ID2);
    const full = DailyPlanItemCreate.parse({
      refOrganizationId: ID,
      refTaskId: ID2,
      date: '2026-01-01',
      sort: 1,
      timeboxStartsAt: '2026-01-01T09:00:00Z',
      timeboxEndsAt: null,
    });
    expect(full.timeboxEndsAt).toBeNull();
  });

  it('DailyPlanItemCreate rejects bad date + bad datetime', () => {
    expect(
      DailyPlanItemCreate.safeParse({ refOrganizationId: ID, refTaskId: ID2, date: 'x' }).success,
    ).toBe(false);
    expect(
      DailyPlanItemCreate.safeParse({
        refOrganizationId: ID,
        refTaskId: ID2,
        date: '2026-01-01',
        timeboxStartsAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('DailyPlanItemUpdate parses', () => {
    expect(
      DailyPlanItemUpdate.parse({ status: 'done', sort: 2, timeboxStartsAt: null }).status,
    ).toBe('done');
  });

  it('DailyPlanItemOut parses', () => {
    expect(
      DailyPlanItemOut.parse({
        id: ID,
        refOrganizationId: ID2,
        refTaskId: ID,
        date: '2026-01-01',
        sort: 0,
        status: 'planned',
        timeboxStartsAt: null,
        timeboxEndsAt: null,
        createdAt: 'x',
      }).status,
    ).toBe('planned');
  });
});

describe('activity DTOs', () => {
  it('AuditSubjectType + AuditEventType accept/reject', () => {
    for (const s of [
      'organization',
      'team',
      'initiative',
      'program',
      'project',
      'cycle',
      'task',
      'actor',
      'agent',
      'agent_session',
      'comment',
      'update',
      'integration',
      'role',
      'grant',
      'membership',
    ] as const) {
      expect(AuditSubjectType.parse(s)).toBe(s);
    }
    expect(AuditSubjectType.safeParse('milestone').success).toBe(false);
    for (const t of [
      'created',
      'updated',
      'state_changed',
      'assigned',
      'commented',
      'archived',
      'deleted',
      'moved',
      'linked',
      'member_added',
      'member_removed',
      'role_changed',
      'grant_changed',
      'approved',
      'rejected',
    ] as const) {
      expect(AuditEventType.parse(t)).toBe(t);
    }
    expect(AuditEventType.safeParse('renamed').success).toBe(false);
  });

  it('AuditEventOut parses + rejects missing metadata', () => {
    const parsed = AuditEventOut.parse({
      id: ID,
      organizationId: ID2,
      actorId: null,
      initiatorId: null,
      subjectType: 'task',
      subjectId: ID,
      type: 'created',
      metadata: { foo: 'bar' },
      createdAt: 'x',
    });
    expect(parsed.metadata).toEqual({ foo: 'bar' });
    expect(
      AuditEventOut.safeParse({
        id: ID,
        organizationId: ID2,
        subjectType: 'task',
        subjectId: ID,
        type: 'created',
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('calendar DTOs', () => {
  it('CalendarConnectionOut parses a connected Google account', () => {
    const parsed = CalendarConnectionOut.parse({
      id: ID,
      provider: 'google',
      externalAccountId: 'google-sub-1',
      accountEmail: 'ada@example.com',
      accountName: 'Ada Lovelace',
      accountPictureUrl: null,
      status: 'connected',
      calendarsTotal: 2,
      calendarsEnabled: 1,
      lastSyncedAt: '2026-06-30T09:00:00.000Z',
      lastError: null,
      scopeState: null,
      createdAt: '2026-06-30T08:00:00.000Z',
      updatedAt: '2026-06-30T09:00:00.000Z',
    });
    expect(parsed.accountEmail).toBe('ada@example.com');
    expect(parsed.calendarsEnabled).toBe(1);
  });

  it('CalendarListOut parses selected calendar configuration', () => {
    const parsed = CalendarListOut.parse({
      id: ID2,
      connectionId: ID,
      externalCalendarId: 'primary',
      title: 'Ada',
      description: null,
      timezone: 'America/Los_Angeles',
      color: '#16a34a',
      accessRole: 'owner',
      primary: true,
      selected: true,
      visibleByDefault: true,
      lastSyncedAt: null,
      lastError: null,
      updatedAt: '2026-06-30T09:00:00.000Z',
    });
    expect(parsed.selected).toBe(true);
  });

  it('CalendarEventOut parses all-day and timed Google events', () => {
    const timed = CalendarEventOut.parse({
      id: ID3,
      connectionId: ID,
      calendarId: ID2,
      externalCalendarId: 'primary',
      externalEventId: 'event-1',
      status: 'confirmed',
      title: 'Design review',
      description: 'Bring notes',
      location: 'Room 3',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
      startsAt: '2026-06-30T16:00:00.000Z',
      endsAt: '2026-06-30T17:00:00.000Z',
      allDayStartDate: null,
      allDayEndDate: null,
      organizer: { email: 'ada@example.com', displayName: 'Ada', self: true },
      attendees: [{ email: 'grace@example.com', displayName: 'Grace', responseStatus: 'accepted' }],
      updatedExternalAt: '2026-06-30T15:00:00.000Z',
      createdAt: '2026-06-30T15:01:00.000Z',
      updatedAt: '2026-06-30T15:01:00.000Z',
    });
    expect(timed.startsAt).toContain('T16:00');

    const allDay = CalendarEventOut.parse({
      ...timed,
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-06-30',
      allDayEndDate: '2026-07-01',
    });
    expect(allDay.allDayStartDate).toBe('2026-06-30');
  });

  it('AgendaOut mixes Docket timeboxes and selected Google events', () => {
    const parsed = AgendaOut.parse({
      date: '2026-06-30',
      entries: [
        {
          kind: 'task_timebox',
          taskId: ID,
          organizationId: ID2,
          title: 'Ship calendar',
          state: 'todo',
          priority: 'high',
          startsAt: '2026-06-30T15:00:00.000Z',
          endsAt: '2026-06-30T16:00:00.000Z',
        },
        {
          kind: 'google_calendar_event',
          event: {
            id: ID3,
            connectionId: ID,
            calendarId: ID2,
            externalCalendarId: 'primary',
            externalEventId: 'event-1',
            status: 'confirmed',
            title: 'Design review',
            description: null,
            location: null,
            htmlLink: null,
            startsAt: '2026-06-30T16:00:00.000Z',
            endsAt: '2026-06-30T17:00:00.000Z',
            allDayStartDate: null,
            allDayEndDate: null,
            organizer: null,
            attendees: [],
            updatedExternalAt: null,
            createdAt: '2026-06-30T15:01:00.000Z',
            updatedAt: '2026-06-30T15:01:00.000Z',
          },
          connection: { id: ID, accountEmail: 'ada@example.com', accountName: 'Ada' },
          calendar: { id: ID2, title: 'Ada', color: '#16a34a', timezone: 'America/Los_Angeles' },
        },
      ],
    });
    expect(parsed.entries.map((entry) => entry.kind)).toEqual([
      'task_timebox',
      'google_calendar_event',
    ]);
  });

  it('AgendaQuery accepts calendar filters for temporary agenda views', () => {
    const parsed = AgendaQuery.parse({
      date: '2026-06-30',
      connectionIds: [ID],
      calendarIds: [ID2],
      includeGoogleCalendar: true,
    });
    expect(parsed.calendarIds).toEqual([ID2]);
  });

  it('CalendarEventCreateTask targets a workspace and stores event attachment context', () => {
    const parsed = CalendarEventCreateTask.parse({
      organizationId: ID2,
      teamId: ID3,
      title: 'Follow up: Design review',
      note: 'Turn the event into a task.',
    });
    expect(parsed.title).toContain('Follow up');
  });

  it('CalendarSyncResultOut reports pulled accounts, calendars, and events', () => {
    const parsed = CalendarSyncResultOut.parse({
      connections: 2,
      calendars: 4,
      eventsCreated: 5,
      eventsUpdated: 3,
      eventsDeleted: 1,
      errors: [],
      layers: 4,
      itemsCreated: 5,
      itemsUpdated: 3,
      itemsArchived: 1,
      writesApplied: 0,
      writesPending: 0,
      conflicts: 0,
    });
    expect(parsed.eventsCreated + parsed.eventsUpdated).toBe(8);
    expect(parsed.itemsCreated + parsed.itemsUpdated).toBe(8);
  });

  it('AttachmentCreate accepts a Google Calendar event attachment', () => {
    const parsed = AttachmentCreate.parse({
      kind: 'calendar_event',
      title: 'Design review',
      externalId: 'event-1',
      metadata: { calendarId: ID2, connectionId: ID, startsAt: '2026-06-30T16:00:00.000Z' },
    });
    expect(parsed.kind).toBe('calendar_event');
  });

  it('attachments can name an Initiative as their subject', () => {
    expect(AttachmentSubjectType.parse('initiative')).toBe('initiative');
    expect(AttachmentSubjectType.parse('project')).toBe('project');
  });

  it('AttachmentCreate rejects a calendar event attachment without an external event id', () => {
    expect(
      AttachmentCreate.safeParse({
        kind: 'calendar_event',
        title: 'Design review',
        metadata: { calendarId: ID2, connectionId: ID },
      }).success,
    ).toBe(false);
  });

  it('CalendarAgendaEventOut rejects events from unselected calendars at the contract edge', () => {
    expect(
      CalendarAgendaEventOut.safeParse({
        kind: 'google_calendar_event',
        event: null,
        connection: { id: ID, accountEmail: 'ada@example.com', accountName: 'Ada' },
        calendar: { id: ID2, title: 'Ada', color: null, timezone: null },
      }).success,
    ).toBe(false);
  });
});

describe('hub DTOs', () => {
  it('HubTaskItem parses + rejects bad priority', () => {
    const parsed = HubTaskItem.parse({
      id: ID,
      organizationId: ID2,
      title: 'T',
      state: 'todo',
      priority: 'high',
      assigneeId: null,
      projectId: null,
      dueDate: null,
    });
    expect(parsed.priority).toBe('high');
    expect(
      HubTaskItem.safeParse({
        id: ID,
        organizationId: ID2,
        title: 'T',
        state: 'todo',
        priority: 'huge',
      }).success,
    ).toBe(false);
  });

  it('HubProjectItem parses', () => {
    expect(
      HubProjectItem.parse({
        id: ID,
        organizationId: ID2,
        name: 'P',
        status: 'started',
        health: null,
        targetDate: null,
      }).name,
    ).toBe('P');
  });

  it('HubTodayOut parses', () => {
    const parsed = HubTodayOut.parse({
      date: '2026-01-01',
      plan: [{ id: ID, organizationId: ID2, title: 'T', state: 'todo', priority: 'none' }],
      calendar: [
        {
          taskId: ID,
          organizationId: ID2,
          startsAt: '2026-01-01T09:00:00.000Z',
          endsAt: '2026-01-01T10:00:00.000Z',
        },
      ],
      needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 2 },
    });
    expect(parsed.plan).toHaveLength(1);
    expect(parsed.needsAttention.inbox).toBe(2);
  });

  it('HubInboxOut parses', () => {
    const parsed = HubInboxOut.parse({
      items: [{ id: ID, userId: 'u', type: 'mention', body: { title: 'T' }, createdAt: 'x' }],
    });
    expect(parsed.items).toHaveLength(1);
  });

  it('HubPortfolioOut parses', () => {
    const parsed = HubPortfolioOut.parse({
      swimlanes: [
        {
          organization: { id: ID2, name: 'Acme', slug: 'acme' },
          programs: [
            {
              program: { id: ID, organizationId: ID2, name: 'Ops', status: 'active' },
              projects: [
                {
                  id: ID,
                  organizationId: ID2,
                  name: 'P',
                  status: 'active',
                  startDate: null,
                  targetDate: null,
                  milestones: [{ id: ID, name: 'M1', targetDate: null }],
                },
              ],
            },
          ],
          unassigned: [],
        },
      ],
    });
    expect(parsed.swimlanes).toHaveLength(1);
    expect(parsed.swimlanes[0]?.programs[0]?.projects[0]?.milestones).toHaveLength(1);
  });

  it('HubSearchOut parses semantic results + rejects a bad kind', () => {
    const parsed = HubSearchOut.parse({
      query: 'q',
      items: [
        {
          id: `task:${ID2}:${ID}`,
          organizationId: ID2,
          userId: null,
          kind: 'task',
          family: 'work',
          title: 'T',
          summary: null,
          snippet: null,
          matchedFields: ['title'],
          route: {
            type: 'entity',
            organizationId: ID2,
            entityKind: 'task',
            entityId: ID,
            href: `/orgs/${ID2}/my-work`,
          },
          subject: null,
          source: { system: 'docket', externalUrl: null, eventId: null },
          facets: {},
          actions: [],
          score: 100,
        },
      ],
      facets: [],
    });
    expect(parsed.query).toBe('q');
    expect(parsed.items).toHaveLength(1);
    expect(
      HubSearchOut.safeParse({
        query: 'q',
        items: [
          {
            id: 'bad',
            organizationId: ID2,
            userId: null,
            kind: 'nonsense',
            family: 'work',
            title: 'T',
            summary: null,
            snippet: null,
            matchedFields: [],
            route: {
              type: 'entity',
              organizationId: ID2,
              entityKind: 'task',
              entityId: ID,
              href: `/orgs/${ID2}/my-work`,
            },
            subject: null,
            source: null,
            facets: {},
            actions: [],
            score: 1,
          },
        ],
        facets: [],
      }).success,
    ).toBe(false);
  });

  it('HubActivityOut parses with a cursor', () => {
    const parsed = HubActivityOut.parse({
      items: [
        {
          id: ID,
          organizationId: ID2,
          subjectType: 'task',
          subjectId: 'sub',
          type: 'created',
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: 'cur',
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBe('cur');
  });
});

describe('event DTOs', () => {
  it('EventKind / InboundEventStatus / DailyDigestStatus accept/reject', () => {
    for (const k of [
      'message',
      'mention',
      'assignment',
      'status_change',
      'comment',
      'reaction',
      'created',
      'completed',
      'calendar_invite',
      'calendar_update',
      'task_assignment',
    ] as const) {
      expect(EventKind.parse(k)).toBe(k);
    }
    expect(EventKind.safeParse('like').success).toBe(false);
    for (const s of ['received', 'processing', 'processed', 'failed', 'skipped'] as const) {
      expect(InboundEventStatus.parse(s)).toBe(s);
    }
    expect(InboundEventStatus.safeParse('queued').success).toBe(false);
    for (const s of [
      'pending',
      'generating',
      'generated',
      'sent',
      'failed',
      'skipped_empty',
    ] as const) {
      expect(DailyDigestStatus.parse(s)).toBe(s);
    }
    expect(DailyDigestStatus.safeParse('draft').success).toBe(false);
  });

  it('EventOut parses with null + canonical nested shapes', () => {
    const parsed = EventOut.parse({
      id: ID,
      organizationId: ID2,
      userId: 'user-1',
      kind: 'mention',
      occurredAt: '2026-06-28T12:00:00.000Z',
      title: 'You were mentioned',
      summary: null,
      permalink: 'https://linear.app/x/issue/ABC-1',
      source: { system: 'linear', integrationId: ID, externalUrl: null },
      actor: {
        source: 'linear',
        externalId: 'usr_9',
        displayName: 'Jane',
        avatarUrl: null,
        docketActorId: null,
      },
      entity: {
        kind: 'work_item',
        source: 'linear',
        externalId: 'ABC-1',
        title: 'Ship it',
        url: null,
        docketEntityId: null,
      },
      participants: [],
      detail: null,
      externalId: 'evt_1',
      createdAt: 'x',
    });
    expect(parsed.kind).toBe('mention');
    expect(parsed.entity?.externalId).toBe('ABC-1');
    expect(parsed.entity?.kind).toBe('work_item');
    expect(parsed.summary).toBeNull();
  });

  it('EventOut rejects a bad kind and a missing required field', () => {
    expect(
      EventOut.safeParse({
        id: ID,
        organizationId: ID2,
        userId: null,
        kind: 'like',
        occurredAt: 'x',
        title: 'T',
        summary: null,
        permalink: null,
        source: { system: 'linear', integrationId: null, externalUrl: null },
        actor: null,
        entity: null,
        participants: [],
        detail: null,
        externalId: null,
        createdAt: 'x',
      }).success,
    ).toBe(false);
    // `title` is required content; omitting it fails.
    expect(
      EventOut.safeParse({
        id: ID,
        organizationId: ID2,
        userId: null,
        kind: 'mention',
        occurredAt: 'x',
        source: { system: 'linear', integrationId: null, externalUrl: null },
        participants: [],
        createdAt: 'x',
      }).success,
    ).toBe(false);
  });

  it('InboundEventOut parses with a null organizationId (unrouted)', () => {
    const parsed = InboundEventOut.parse({
      id: ID,
      organizationId: null,
      integrationId: null,
      provider: 'linear',
      externalEventId: 'evt_1',
      eventType: 'Issue',
      signatureVerified: true,
      status: 'received',
      attempts: 0,
      lastError: null,
      receivedAt: 'x',
      processedAt: null,
    });
    expect(parsed.signatureVerified).toBe(true);
    expect(parsed.organizationId).toBeNull();
  });

  it('DailyDigestOut parses with stats + nullable bodies', () => {
    const parsed = DailyDigestOut.parse({
      id: ID,
      userId: 'user-1',
      digestDate: '2026-06-28',
      status: 'sent',
      summaryMarkdown: '# Today',
      summaryHtml: '<h1>Today</h1>',
      stats: { total: 3, bySource: { linear: 3 }, byKind: { mention: 2, assignment: 1 } },
      eventCount: 3,
      generatedAt: 'x',
      sentAt: 'y',
      createdAt: 'z',
    });
    expect(parsed.status).toBe('sent');
    expect(parsed.stats?.total).toBe(3);
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
