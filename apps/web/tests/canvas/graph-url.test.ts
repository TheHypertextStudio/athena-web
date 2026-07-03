/**
 * Unit tests for the canvas filter/layout URL codec.
 *
 * @remarks
 * Pure round-trip logic worth its own gate: a serialized state parses back identically, unrelated
 * (scope) params survive, empty facets emit no keys, and a garbled/hand-edited URL degrades to a
 * usable partial state rather than throwing.
 */
import { describe, expect, it } from 'vitest';

import {
  GRAPH_PARAM_KEYS,
  type GraphUrlState,
  parseGraphUrl,
  serializeGraphUrl,
} from '@/components/canvas/graph-url';

/** Build a state from terse inputs. */
function state(search: string, projects: string[], direction: 'LR' | 'TB'): GraphUrlState {
  return {
    filter: {
      search,
      projects: new Set(projects),
      assignees: new Set(),
      priorities: new Set(),
      stateTypes: new Set(),
    },
    direction,
  };
}

describe('graph-url codec', () => {
  it('round-trips a configured state', () => {
    const original = state('login', ['p1', 'p2'], 'TB');
    const parsed = parseGraphUrl(serializeGraphUrl(original));
    expect(parsed.filter.search).toBe('login');
    expect([...parsed.filter.projects].sort()).toEqual(['p1', 'p2']);
    expect(parsed.direction).toBe('TB');
  });

  it('emits no keys for the empty state', () => {
    const params = serializeGraphUrl(state('', [], 'LR'));
    for (const key of GRAPH_PARAM_KEYS) expect(params.has(key)).toBe(false);
  });

  it('preserves unrelated (scope) params', () => {
    const base = new URLSearchParams('rootTaskId=t1&depth=3');
    const params = serializeGraphUrl(state('x', [], 'LR'), base);
    expect(params.get('rootTaskId')).toBe('t1');
    expect(params.get('depth')).toBe('3');
    expect(params.get('q')).toBe('x');
  });

  it('replaces its own keys without duplicating them on re-serialize', () => {
    const first = serializeGraphUrl(state('a', ['p1'], 'TB'));
    const second = serializeGraphUrl(state('b', [], 'LR'), first);
    expect(second.getAll('q')).toEqual(['b']);
    expect(second.has('fp')).toBe(false);
    expect(second.has('dir')).toBe(false);
  });

  it('degrades gracefully on a malformed URL', () => {
    const parsed = parseGraphUrl(new URLSearchParams('fp=,,&dir=sideways'));
    expect(parsed.filter.projects.size).toBe(0); // empty members dropped
    expect(parsed.direction).toBe('LR'); // unknown direction falls back
  });
});
