/**
 * The provenance formatter: one entry per recorded channel, as the spec's display table lists.
 *
 * @remarks
 * Names that come from the record (a teammate, a client, a provider) are asserted exactly, since
 * they are data. Docket's own words are asserted by shape: present or absent, and distinct where
 * two channels must read differently.
 */
import { ActorId } from '@docket/identity-access/ids';
import { PROVENANCE_CHANNELS, type ProvenanceEventOut } from '@docket/work/provenance-contract';
import { describe, expect, it } from 'vitest';

import {
  type ProvenanceAuthority,
  type ProvenanceOrigin,
  formatProvenance,
  formatProvenanceEvent,
  providerLabel,
} from '../../../src/lib/provenance/format';

const ME = ActorId.parse('01ARZ3NDEKTSV4RRFFQ69G5F91');
const TEAMMATE = ActorId.parse('01ARZ3NDEKTSV4RRFFQ69G5F92');

const mine: ProvenanceAuthority = { actorId: ME, name: 'Ada Lovelace' };
const teammates: ProvenanceAuthority = { actorId: TEAMMATE, name: 'Grace Hopper' };

/** An origin with every optional field empty; `overrides` sets what a case is about. */
function origin(overrides: Partial<ProvenanceOrigin>): ProvenanceOrigin {
  return {
    channel: 'app',
    surface: null,
    performerKind: 'person',
    performerName: null,
    clientName: null,
    provider: null,
    ...overrides,
  };
}

describe('formatProvenance: app', () => {
  it('names the viewer differently from the authority’s own name', () => {
    const display = formatProvenance(origin({ surface: 'detail' }), mine, ME);
    expect(display).not.toBeNull();
    expect(display?.performer).not.toBe(mine.name);
    expect(display?.detail).toBeNull();
    expect(display?.avatarKind).toBe('human');
    expect(display?.avatarName).toBe(mine.name);
  });

  it('names a teammate by their name', () => {
    const display = formatProvenance(origin({ surface: 'list' }), teammates, ME);
    expect(display).toEqual({ performer: 'Grace Hopper', detail: null, avatarKind: 'human' });
  });

  it('names nobody when the change carries no authority', () => {
    expect(formatProvenance(origin({}), null, ME)).toBeNull();
  });
});

describe('formatProvenance: Athena', () => {
  it('gives chat, phone, and session each their own detail under one performer', () => {
    const chat = formatProvenance(
      origin({ channel: 'athena', surface: 'chat', performerKind: 'athena' }),
      mine,
      ME,
    );
    const phone = formatProvenance(
      origin({ channel: 'athena', surface: 'phone', performerKind: 'athena' }),
      mine,
      ME,
    );
    const session = formatProvenance(
      origin({ channel: 'athena', surface: 'session', performerKind: 'athena' }),
      mine,
      ME,
    );
    expect(chat?.performer).toBe(phone?.performer);
    expect(chat?.avatarKind).toBe('agent');
    expect(new Set([chat?.detail, phone?.detail, session?.detail]).size).toBe(3);
    expect(chat?.detail).not.toBeNull();
  });

  it('reads email accepted as work as Athena, with its own detail', () => {
    const email = formatProvenance(origin({ channel: 'email', performerKind: 'athena' }), mine, ME);
    const chat = formatProvenance(
      origin({ channel: 'athena', surface: 'chat', performerKind: 'athena' }),
      mine,
      ME,
    );
    expect(email?.performer).toBe(chat?.performer);
    expect(email?.detail).not.toBeNull();
    expect(email?.detail).not.toBe(chat?.detail);
    expect(email?.avatarKind).toBe('agent');
  });
});

describe('formatProvenance: MCP and API clients', () => {
  const claude = origin({ channel: 'mcp', performerKind: 'agent', performerName: 'Claude Code' });

  it('names the client and says who it worked for', () => {
    const forMe = formatProvenance(claude, mine, ME);
    const forTeammate = formatProvenance(claude, teammates, ME);
    expect(forMe?.performer).toBe('Claude Code');
    expect(forMe?.avatarKind).toBe('agent');
    expect(forMe?.detail).not.toBeNull();
    expect(forMe?.detail).not.toContain(mine.name);
    expect(forTeammate?.detail).toContain('Grace Hopper');
  });

  it('falls back to the client name when the performer carries none', () => {
    const display = formatProvenance(
      origin({ channel: 'mcp', performerKind: 'agent', clientName: 'Cursor' }),
      mine,
      ME,
    );
    expect(display?.performer).toBe('Cursor');
  });

  it('names a registered agent by its own actor, with no one to work for', () => {
    const agent: ProvenanceAuthority = { actorId: 'agent-actor', name: 'Triage Bot' };
    const display = formatProvenance(origin({ channel: 'mcp', performerKind: 'agent' }), agent, ME);
    expect(display).toEqual({ performer: 'Triage Bot', detail: null, avatarKind: 'agent' });
  });

  it('names nothing for an MCP change with no client and no authority', () => {
    expect(formatProvenance(origin({ channel: 'mcp', performerKind: 'agent' }), null, ME)).toBe(
      null,
    );
  });

  it('names a REST client with a detail distinct from MCP', () => {
    const api = formatProvenance(
      origin({ channel: 'api', performerKind: 'agent', clientName: 'Zapier' }),
      mine,
      ME,
    );
    expect(api?.performer).toBe('Zapier');
    expect(api?.detail).not.toBeNull();
    expect(api?.avatarKind).toBe('agent');
    expect(formatProvenance(origin({ channel: 'api', performerKind: 'agent' }), null, ME)).toBe(
      null,
    );
  });
});

describe('formatProvenance: connected tools and rules', () => {
  it('names the provider for sync and import, with a detail for each', () => {
    const sync = formatProvenance(
      origin({ channel: 'sync', performerKind: 'docket', provider: 'linear' }),
      mine,
      ME,
    );
    const imported = formatProvenance(
      origin({ channel: 'import', performerKind: 'docket', provider: 'notion' }),
      mine,
      ME,
    );
    expect(sync?.performer).toBe('Linear');
    expect(imported?.performer).toBe('Notion');
    expect(sync?.detail).not.toBe(imported?.detail);
    expect(sync?.avatarKind).toBe('agent');
  });

  it('falls back to the performer name, and names nothing without either', () => {
    expect(
      formatProvenance(
        origin({ channel: 'sync', performerKind: 'docket', performerName: 'Jira' }),
        mine,
        ME,
      )?.performer,
    ).toBe('Jira');
    expect(formatProvenance(origin({ channel: 'import', performerKind: 'docket' }), mine, ME)).toBe(
      null,
    );
  });

  it('names a rule Docket runs, with the rule as the detail', () => {
    const recurrence = formatProvenance(
      origin({ channel: 'rule', surface: 'recurrence', performerKind: 'docket' }),
      null,
      ME,
    );
    const routing = formatProvenance(
      origin({ channel: 'rule', surface: 'routing', performerKind: 'docket' }),
      null,
      ME,
    );
    expect(recurrence?.avatarKind).toBe('agent');
    expect(recurrence?.detail).not.toBeNull();
    expect(recurrence?.detail).not.toBe(routing?.detail);
    expect(recurrence?.performer).toBe(routing?.performer);
    for (const surface of ['cycle_roll', 'calendar_link', 'time_anchor'] as const) {
      expect(
        formatProvenance(origin({ channel: 'rule', surface, performerKind: 'docket' }), null, ME)
          ?.detail,
      ).not.toBeNull();
    }
    expect(
      formatProvenance(origin({ channel: 'rule', performerKind: 'docket' }), null, ME)?.detail,
    ).toBeNull();
  });

  it('answers for every channel the contract declares', () => {
    for (const channel of PROVENANCE_CHANNELS) {
      const display = formatProvenance(
        origin({ channel, performerKind: 'agent', clientName: 'Client', provider: 'github' }),
        mine,
        ME,
      );
      expect(display, channel).not.toBeNull();
    }
  });
});

describe('providerLabel', () => {
  it('uses the catalog name, and capitalizes an unknown key', () => {
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('asana')).toBe('Asana');
  });
});

describe('formatProvenanceEvent', () => {
  it('reads the authority off the event', () => {
    const event: ProvenanceEventOut = {
      at: '2026-09-20T10:00:00.000Z',
      channel: 'app',
      surface: 'detail',
      performerKind: 'person',
      performerName: null,
      authorityActorId: TEAMMATE,
      authorityName: 'Grace Hopper',
      clientName: null,
      provider: null,
      sessionId: null,
      planId: null,
    };
    expect(formatProvenanceEvent(event, ME)?.performer).toBe('Grace Hopper');
    const own = formatProvenanceEvent({ ...event, authorityActorId: ME }, ME);
    expect(own?.performer).not.toBe('Grace Hopper');
  });
});
