import { describe, expect, it } from 'vitest';

import { isAppSurface, readOrigin, toActivityOrigin } from '../src/contracts/provenance';

describe('readOrigin', () => {
  it('returns null for a missing origin', () => {
    expect(readOrigin(null)).toBeNull();
    expect(readOrigin(undefined)).toBeNull();
  });

  it('reads a recorded origin as stored', () => {
    const provenance = readOrigin({
      v: 2,
      channel: 'mcp',
      performer: { kind: 'agent', name: 'Claude' },
      client: 'Claude',
      clientId: 'client_1',
      clientVersion: '1.2.0',
      sessionId: 'sess_1',
      tool: 'capture',
    });

    expect(provenance).toEqual({
      channel: 'mcp',
      surface: null,
      performer: { kind: 'agent', name: 'Claude' },
      client: { id: 'client_1', name: 'Claude', version: '1.2.0' },
      integration: null,
      sessionId: 'sess_1',
      planId: null,
      ref: null,
    });
  });

  it('places first-version origins by what they recorded', () => {
    expect(
      readOrigin({ client: 'athena-phone', sessionId: 'voice_1', tool: 'create_task' }),
    ).toMatchObject({ channel: 'athena', surface: 'phone', performer: { kind: 'athena' } });
    expect(readOrigin({ tool: 'canvas', sessionId: 'cmd_1' })).toMatchObject({
      channel: 'app',
      surface: 'canvas',
    });
    expect(readOrigin({ tool: 'plan_commit' })).toMatchObject({ channel: 'app', surface: 'plan' });
    expect(readOrigin({ tool: 'capture', planId: 'plan_1' })).toMatchObject({ surface: 'plan' });
    expect(readOrigin({ tool: 'capture', client: 'Cursor' })).toMatchObject({
      channel: 'mcp',
      performer: { kind: 'agent', name: 'Cursor' },
    });
    expect(readOrigin({ tool: 'update', sessionId: 'athena_1' })).toMatchObject({
      channel: 'athena',
      surface: 'session',
    });
  });

  it('places a first-version MCP plan commit with its caller, not the app', () => {
    expect(
      readOrigin({ tool: 'plan_commit', sessionId: 'athena_1', planId: 'plan_1' }),
    ).toMatchObject({ channel: 'athena', performer: { kind: 'athena' } });
    expect(
      readOrigin({ tool: 'plan_commit', client: 'Release bot', planId: 'plan_1' }),
    ).toMatchObject({ channel: 'mcp', performer: { kind: 'agent', name: 'Release bot' } });
  });

  it('cannot place a first-version origin that recorded only its tool', () => {
    expect(readOrigin({ tool: 'task_description_expansion' })).toBeNull();
  });

  it('defaults a recorded origin without a performer to a person', () => {
    expect(readOrigin({ channel: 'app', tool: 'patch' })?.performer).toEqual({ kind: 'person' });
  });
});

describe('toActivityOrigin', () => {
  it('projects the fields an activity row shows', () => {
    const provenance = readOrigin({
      v: 2,
      channel: 'sync',
      performer: { kind: 'docket', name: 'linear' },
      integration: { id: 'int_1', provider: 'linear' },
      tool: 'reconcile',
    });

    expect(provenance && toActivityOrigin(provenance)).toEqual({
      channel: 'sync',
      surface: null,
      performerKind: 'docket',
      performerName: 'linear',
      clientName: null,
      provider: 'linear',
    });
  });
});

describe('isAppSurface', () => {
  it('accepts only app surfaces', () => {
    expect(isAppSurface('detail')).toBe(true);
    expect(isAppSurface('phone')).toBe(false);
    expect(isAppSurface('')).toBe(false);
    expect(isAppSurface(null)).toBe(false);
    expect(isAppSurface(undefined)).toBe(false);
  });
});
