/**
 * Unit tests for the pure picker option-sourcing mappers.
 *
 * @remarks
 * These mappers translate the org's DTOs and the bounded enums into the {@link PickerOption}
 * arrays the composers + property panels consume. They are pure (no React tree, no RPC), so they
 * are pinned directly: the ids reported back, the human labels, the agent-vs-human tagging, and
 * the enum ordering all matter because the composers thread `option.value` straight into the
 * create DTOs.
 *
 * Fixtures parse through the shared DTO schemas so the tests exercise the same branded shapes the
 * app receives from the API, without carrying local parallel DTO assertions.
 */
import {
  AgentOut,
  CycleOut,
  InitiativeOut,
  LabelOut,
  MemberOut,
  ProgramOut,
  ProjectOut,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  actorOptions,
  cycleOptions,
  enumOptions,
  HEALTH_OPTIONS,
  initiativeOptions,
  labelOptions,
  PRIORITY_OPTIONS,
  programOptions,
  projectOptions,
} from '../../src/components/pickers/options';

const IDS = {
  org: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ada: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  bot: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  lonelyBot: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  agent: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  project: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  program: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  initiative: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
  cycleNamed: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
  cycleUnnamed: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
  team: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
  label: '01ARZ3NDEKTSV4RRFFQ69G5FB6',
} as const;

const CREATED_AT = '2026-07-06T00:00:00.000Z';

/** Build a member fixture through the shared DTO schema. */
function member(actorId: string, displayName: string): MemberOut {
  return MemberOut.parse({
    actorId,
    organizationId: IDS.org,
    displayName,
    avatar: null,
    status: 'active',
    roleId: null,
    userId: null,
    createdAt: CREATED_AT,
  });
}

/** Build an agent fixture through the shared DTO schema. */
function agent(actorId: string): AgentOut {
  return AgentOut.parse({
    id: IDS.agent,
    organizationId: IDS.org,
    actorId,
    connection: null,
    approvalPolicy: 'autonomous',
    accountableOwnerId: null,
    guidance: null,
    approvalRouting: null,
    createdAt: CREATED_AT,
  });
}

describe('picker option mappers', () => {
  it('maps members to actor options keyed by actor id', () => {
    const options = actorOptions([member(IDS.ada, 'Ada Lovelace')]);
    expect(options).toHaveLength(1);
    const [option] = options;
    expect(option).toMatchObject({ value: IDS.ada, label: 'Ada Lovelace' });
    expect(option?.icon).toBeDefined();
  });

  it('tags an actor as an agent when it appears in the agents list', () => {
    const [option] = actorOptions([member(IDS.bot, 'Triage Bot')], [agent(IDS.bot)]);
    // The icon is an ActorAvatar; agent-ness is carried via its `kind` prop.
    expect(option?.value).toBe(IDS.bot);
    const icon = option?.icon as { props?: { kind?: string } };
    expect(icon.props?.kind).toBe('agent');
  });

  it('includes an agent with no naming member row as a selectable "Agent" option', () => {
    const options = actorOptions([], [agent(IDS.lonelyBot)]);
    expect(options).toEqual([expect.objectContaining({ value: IDS.lonelyBot, label: 'Agent' })]);
  });

  it('maps entity DTOs to {value:id, label:name} options', () => {
    const project = ProjectOut.parse({
      id: IDS.project,
      organizationId: IDS.org,
      name: 'Apollo',
      description: null,
      status: 'active',
      health: null,
      leadId: null,
      teamId: null,
      programId: null,
      startDate: null,
      targetDate: null,
      createdAt: CREATED_AT,
    });
    const program = ProgramOut.parse({
      id: IDS.program,
      organizationId: IDS.org,
      name: 'Platform',
      summary: null,
      description: null,
      ownerId: null,
      status: 'active',
      health: null,
      visibility: 'private',
      createdAt: CREATED_AT,
    });
    const initiative = InitiativeOut.parse({
      id: IDS.initiative,
      organizationId: IDS.org,
      name: 'Q3',
      description: null,
      summary: null,
      ownerId: null,
      status: 'active',
      priority: 'none',
      updateCadence: 'monthly',
      targetDate: null,
      health: null,
      createdAt: CREATED_AT,
    });
    expect(projectOptions([project])).toEqual([{ value: IDS.project, label: 'Apollo' }]);
    expect(programOptions([program])).toEqual([{ value: IDS.program, label: 'Platform' }]);
    expect(initiativeOptions([initiative])).toEqual([{ value: IDS.initiative, label: 'Q3' }]);
  });

  it('labels an unnamed cycle by its number with the cycle noun', () => {
    const named = CycleOut.parse({
      id: IDS.cycleNamed,
      organizationId: IDS.org,
      teamId: IDS.team,
      number: 4,
      name: 'Launch',
      startsAt: '2026-07-06',
      endsAt: '2026-07-20',
      status: 'active',
      createdAt: CREATED_AT,
    });
    const unnamed = CycleOut.parse({
      id: IDS.cycleUnnamed,
      organizationId: IDS.org,
      teamId: IDS.team,
      number: 7,
      name: null,
      startsAt: '2026-07-20',
      endsAt: '2026-08-03',
      status: 'active',
      createdAt: CREATED_AT,
    });
    const options = cycleOptions([named, unnamed], 'Sprint');
    expect(options).toEqual([
      { value: IDS.cycleNamed, label: 'Launch' },
      { value: IDS.cycleUnnamed, label: 'Sprint 7' },
    ]);
  });

  it('maps labels to options carrying their color swatch as the icon', () => {
    const label = LabelOut.parse({
      id: IDS.label,
      organizationId: IDS.org,
      name: 'Bug',
      color: '#ef4444',
      group: null,
      teamId: null,
      createdAt: CREATED_AT,
    });
    const [option] = labelOptions([label]);
    expect(option).toMatchObject({ value: IDS.label, label: 'Bug' });
    expect(option?.icon).toBeDefined();
  });

  it('orders priority options most-pressing first, ending with No priority', () => {
    expect(PRIORITY_OPTIONS.map((o) => o.value)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ]);
  });

  it('orders health options best to worst', () => {
    expect(HEALTH_OPTIONS.map((o) => o.value)).toEqual(['on_track', 'at_risk', 'off_track']);
    expect(HEALTH_OPTIONS.map((o) => o.label)).toEqual(['On track', 'At risk', 'Off track']);
  });

  it('builds enum options from an ordered literal list and a label map', () => {
    const options = enumOptions(['active', 'paused'] as const, {
      active: 'Active',
      paused: 'Paused',
    });
    expect(options).toEqual([
      { value: 'active', label: 'Active' },
      { value: 'paused', label: 'Paused' },
    ]);
  });
});
