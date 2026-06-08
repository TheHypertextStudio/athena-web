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
 * Fixtures are plain structural shapes cast to the DTO param types — the mappers read only a few
 * fields off each DTO, so a full branded/parsed value is unnecessary here.
 */
import type {
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

/** Build a member-shaped fixture (only the fields the mapper reads). */
function member(actorId: string, displayName: string): MemberOut {
  return { actorId, displayName, avatar: null } as unknown as MemberOut;
}

/** Build an agent-shaped fixture (only the `actorId` the mapper reads). */
function agent(actorId: string): AgentOut {
  return { actorId } as unknown as AgentOut;
}

describe('picker option mappers', () => {
  it('maps members to actor options keyed by actor id', () => {
    const options = actorOptions([member('act_1', 'Ada Lovelace')]);
    expect(options).toHaveLength(1);
    const [option] = options;
    expect(option).toMatchObject({ value: 'act_1', label: 'Ada Lovelace' });
    expect(option?.icon).toBeDefined();
  });

  it('tags an actor as an agent when it appears in the agents list', () => {
    const [option] = actorOptions([member('act_bot', 'Triage Bot')], [agent('act_bot')]);
    // The icon is an ActorAvatar; agent-ness is carried via its `kind` prop.
    expect(option?.value).toBe('act_bot');
    const icon = option?.icon as { props?: { kind?: string } };
    expect(icon.props?.kind).toBe('agent');
  });

  it('includes an agent with no naming member row as a selectable "Agent" option', () => {
    const options = actorOptions([], [agent('act_lonely')]);
    expect(options).toEqual([expect.objectContaining({ value: 'act_lonely', label: 'Agent' })]);
  });

  it('maps entity DTOs to {value:id, label:name} options', () => {
    // The mappers read only id + name off each DTO, so partial shapes are sufficient.
    const project = { id: 'proj_1', name: 'Apollo' } as unknown as ProjectOut;
    const program = { id: 'prog_1', name: 'Platform' } as unknown as ProgramOut;
    const initiative = { id: 'init_1', name: 'Q3' } as unknown as InitiativeOut;
    expect(projectOptions([project])).toEqual([{ value: 'proj_1', label: 'Apollo' }]);
    expect(programOptions([program])).toEqual([{ value: 'prog_1', label: 'Platform' }]);
    expect(initiativeOptions([initiative])).toEqual([{ value: 'init_1', label: 'Q3' }]);
  });

  it('labels an unnamed cycle by its number with the cycle noun', () => {
    const named = { id: 'cy_1', name: 'Launch', number: 4 } as unknown as CycleOut;
    const unnamed = { id: 'cy_2', name: null, number: 7 } as unknown as CycleOut;
    const options = cycleOptions([named, unnamed], 'Sprint');
    expect(options).toEqual([
      { value: 'cy_1', label: 'Launch' },
      { value: 'cy_2', label: 'Sprint 7' },
    ]);
  });

  it('maps labels to options carrying their color swatch as the icon', () => {
    const label = { id: 'lbl_1', name: 'Bug', color: '#ef4444' } as unknown as LabelOut;
    const [option] = labelOptions([label]);
    expect(option).toMatchObject({ value: 'lbl_1', label: 'Bug' });
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
