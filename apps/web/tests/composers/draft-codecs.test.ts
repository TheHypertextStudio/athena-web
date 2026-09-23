/**
 * The five composer draft codecs: a draft round-trips through its payload, a reference the
 * workspace no longer offers is dropped on the way back, and another kind's payload is ignored.
 */
import type { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { describe, expect, it } from 'vitest';

import type { InitiativeDraft } from '../../src/components/initiatives/create-initiative';
import {
  hydrateInitiativeDraft,
  serializeInitiativeDraft,
} from '../../src/components/initiatives/initiative-draft-codec';
import type { ProgramDraft } from '../../src/components/programs/create-program';
import {
  hydrateProgramDraft,
  serializeProgramDraft,
} from '../../src/components/programs/program-draft-codec';
import type { ProjectDraft } from '../../src/components/projects/create-project';
import {
  hydrateProjectDraft,
  serializeProjectDraft,
} from '../../src/components/projects/project-draft-codec';
import type { TaskDraft } from '../../src/components/tasks/create-task';
import {
  type TaskDraftRosters,
  hydrateTaskDraft,
  serializeTaskDraft,
} from '../../src/components/tasks/task-draft-codec';
import type { TeamDraft } from '../../src/components/teams/create-team';
import {
  hydrateTeamDraft,
  serializeTeamDraft,
  teamNamePatch,
} from '../../src/components/teams/team-draft-codec';

// Branded ids are ULIDs; the codecs brand through `safeParse`, so every id must have the shape.
const TEAM_ID = 'TEAM0000000000000000000002';
const OTHER_TEAM_ID = 'TEAM0000000000000000000008';
const ADA_ID = 'ADA00000000000000000000003';
const APOLLO_ID = 'APR00000000000000000000004';
const BUG_ID = 'BG000000000000000000000005';
const CYCLE_ID = 'CYC1E000000000000000000009';
const MILESTONE_ID = 'M1EST0NE000000000000000010';
const PROGRAM_ID = 'PRG00000000000000000000011';
const INITIATIVE_ID = 'N1T00000000000000000000012';
const GONE_ID = 'G0NE0000000000000000000013';

const TASK_ROSTERS: TaskDraftRosters = {
  teams: [TEAM_ID, OTHER_TEAM_ID],
  defaultTeamId: TEAM_ID,
  statesTeamId: TEAM_ID,
  states: ['backlog', 'todo'],
  actors: [ADA_ID],
  projects: [APOLLO_ID],
  milestones: [{ id: MILESTONE_ID, projectId: APOLLO_ID }],
  cycles: [{ id: CYCLE_ID, teamId: TEAM_ID }],
  labels: [BUG_ID],
};

const TASK: TaskDraft = {
  title: 'Grant report',
  description: 'Draft the narrative.',
  teamOverride: null,
  state: 'todo',
  priority: 'high',
  assigneeId: ADA_ID,
  projectId: APOLLO_ID,
  milestoneId: MILESTONE_ID,
  cycleId: CYCLE_ID,
  startDate: '2026-09-01',
  dueDate: '2026-09-30',
  labelIds: [BUG_ID],
  estimate: 3,
  estimateMinutes: 90,
  repeat: {
    kind: 'calendar',
    schedule: {
      kind: 'daily',
      interval: 1,
      startDate: '2026-09-01',
      timezone: 'UTC',
      end: { kind: 'never' },
    },
    missedPolicy: 'skip',
    materialization: { horizonDays: 30, minimumOccurrences: 2 },
  },
};

const PROJECT: ProjectDraft = {
  name: 'Apollo',
  summary: 'Reach the moon.',
  description: 'Everything about the launch.',
  teamOverride: TEAM_ID,
  leadId: ADA_ID,
  programId: PROGRAM_ID,
  status: 'planned',
  health: 'on_track',
  startTimeframe: { date: '2026-10-01', resolution: 'quarter', fiscalYearStartMonth: 0 },
  targetTimeframe: { date: '2026-12-31', resolution: null, fiscalYearStartMonth: null },
  initiativeIds: [INITIATIVE_ID],
  milestones: [{ key: 'local-1', name: 'Beta', targetDate: '2026-11-01', description: 'Soft.' }],
};

const INITIATIVE: InitiativeDraft = {
  name: 'Grow membership',
  summary: 'Double it.',
  description: 'The plan.',
  ownerId: ADA_ID,
  status: 'active',
  targetTimeframe: { date: '2027-06-30', resolution: 'halfYear', fiscalYearStartMonth: 6 },
  health: 'at_risk',
  priority: 'high',
  updateCadence: 'weekly',
};

const PROGRAM: ProgramDraft = {
  name: 'Community outreach',
  summary: 'Ongoing.',
  description: 'How we show up.',
  ownerId: ADA_ID,
  status: 'active',
  health: null,
  visibility: 'private',
};

const TEAM: TeamDraft = {
  name: 'Engineering',
  key: 'ENGIN',
  keyDirty: false,
  summary: 'Builds the thing.',
  description: 'Owns the platform.',
  triageEnabled: false,
  agentGuidance: 'Ask before deploying.',
};

/** A payload of another kind, to prove each hydrate ignores it. */
const FOREIGN: ComposerDraftPayload = { kind: 'team', name: 'Not this composer' };

describe('task draft codec', () => {
  it('round-trips every field through the payload', () => {
    const payload = serializeTaskDraft(TASK);
    expect(payload.kind).toBe('task');
    expect(hydrateTaskDraft(payload, TASK_ROSTERS)).toEqual(TASK);
  });

  it('drops references the rosters no longer offer', () => {
    const payload = serializeTaskDraft({
      ...TASK,
      assigneeId: GONE_ID,
      projectId: GONE_ID,
      labelIds: [BUG_ID, GONE_ID],
      state: 'retired',
    });
    const hydrated = hydrateTaskDraft(payload, TASK_ROSTERS);
    expect(hydrated.assigneeId).toBeNull();
    expect(hydrated.projectId).toBeNull();
    // The milestone belonged to the dropped project, so it goes with it.
    expect(hydrated.milestoneId).toBeNull();
    expect(hydrated.labelIds).toEqual([BUG_ID]);
    expect(hydrated.state).toBeNull();
    expect(hydrated.title).toBe(TASK.title);
  });

  it('keeps a cycle only for the drafted team and a state only for the loaded team', () => {
    const payload = serializeTaskDraft({ ...TASK, teamOverride: OTHER_TEAM_ID });
    const hydrated = hydrateTaskDraft(payload, TASK_ROSTERS);
    expect(hydrated.teamOverride).toBe(OTHER_TEAM_ID);
    expect(hydrated.cycleId).toBeNull();
    expect(hydrated.state).toBeNull();
  });

  it('falls back to a once-only task when the saved schedule no longer parses', () => {
    const payload = serializeTaskDraft(TASK);
    if (payload.kind !== 'task' || payload.repeat?.kind !== 'calendar') {
      throw new Error('expected a calendar repeat');
    }
    const broken: ComposerDraftPayload = {
      ...payload,
      repeat: { ...payload.repeat, schedule: { kind: 'weekly' } },
    };
    expect(hydrateTaskDraft(broken, TASK_ROSTERS).repeat).toEqual({ kind: 'none' });
  });

  it('ignores another kind of payload', () => {
    expect(hydrateTaskDraft(FOREIGN, TASK_ROSTERS)).toEqual({});
  });
});

describe('project draft codec', () => {
  const rosters = {
    teams: [TEAM_ID],
    actors: [ADA_ID],
    programs: [PROGRAM_ID],
    initiatives: [INITIATIVE_ID],
  };

  it('round-trips every field and mints fresh milestone keys', () => {
    const hydrated = hydrateProjectDraft(serializeProjectDraft(PROJECT), rosters);
    const { milestones, ...rest } = hydrated;
    const { milestones: original, ...originalRest } = PROJECT;
    expect(rest).toEqual(originalRest);
    expect(milestones).toHaveLength(1);
    expect(milestones?.[0]).toMatchObject({
      name: 'Beta',
      targetDate: '2026-11-01',
      description: 'Soft.',
    });
    expect(milestones?.[0]?.key).not.toBe(original[0]?.key);
  });

  it('drops references the rosters no longer offer', () => {
    const payload = serializeProjectDraft({
      ...PROJECT,
      teamOverride: GONE_ID,
      leadId: GONE_ID,
      programId: GONE_ID,
      initiativeIds: [GONE_ID, INITIATIVE_ID],
    });
    const hydrated = hydrateProjectDraft(payload, rosters);
    expect(hydrated.teamOverride).toBeNull();
    expect(hydrated.leadId).toBeNull();
    expect(hydrated.programId).toBeNull();
    expect(hydrated.initiativeIds).toEqual([INITIATIVE_ID]);
  });

  it('leaves the status alone when the payload has none', () => {
    const hydrated = hydrateProjectDraft({ kind: 'project', name: 'Bare' }, rosters);
    expect(hydrated).not.toHaveProperty('status');
    expect(hydrated.name).toBe('Bare');
  });

  it('ignores another kind of payload', () => {
    expect(hydrateProjectDraft(FOREIGN, rosters)).toEqual({});
  });
});

describe('initiative draft codec', () => {
  const rosters = { actors: [ADA_ID] };

  it('round-trips every field through the payload', () => {
    expect(hydrateInitiativeDraft(serializeInitiativeDraft(INITIATIVE), rosters)).toEqual(
      INITIATIVE,
    );
  });

  it('drops an owner the roster no longer offers', () => {
    const payload = serializeInitiativeDraft({ ...INITIATIVE, ownerId: GONE_ID });
    expect(hydrateInitiativeDraft(payload, rosters).ownerId).toBeNull();
  });

  it('ignores another kind of payload', () => {
    expect(hydrateInitiativeDraft(FOREIGN, rosters)).toEqual({});
  });
});

describe('program draft codec', () => {
  const rosters = { actors: [ADA_ID] };

  it('round-trips every field through the payload', () => {
    expect(hydrateProgramDraft(serializeProgramDraft(PROGRAM), rosters)).toEqual(PROGRAM);
  });

  it('drops an owner the roster no longer offers', () => {
    const payload = serializeProgramDraft({ ...PROGRAM, ownerId: GONE_ID });
    expect(hydrateProgramDraft(payload, rosters).ownerId).toBeNull();
  });

  it('ignores another kind of payload', () => {
    const task: ComposerDraftPayload = { kind: 'task', title: 'Not this composer' };
    expect(hydrateProgramDraft(task, rosters)).toEqual({});
  });
});

describe('team draft codec', () => {
  it('round-trips every field through the payload', () => {
    expect(hydrateTeamDraft(serializeTeamDraft(TEAM))).toEqual(TEAM);
  });

  it('marks the key as taken over when it no longer matches the name', () => {
    const payload = serializeTeamDraft({ ...TEAM, key: 'PLAT', keyDirty: true });
    const hydrated = hydrateTeamDraft(payload);
    expect(hydrated.key).toBe('PLAT');
    expect(hydrated.keyDirty).toBe(true);
  });

  it('keeps deriving the key from the name until it is taken over', () => {
    expect(teamNamePatch(TEAM, 'Design Ops')).toEqual({ name: 'Design Ops', key: 'DESIG' });
    expect(teamNamePatch({ ...TEAM, keyDirty: true }, 'Design Ops')).toEqual({
      name: 'Design Ops',
    });
  });

  it('ignores another kind of payload', () => {
    const task: ComposerDraftPayload = { kind: 'task', title: 'Not this composer' };
    expect(hydrateTeamDraft(task)).toEqual({});
  });
});
