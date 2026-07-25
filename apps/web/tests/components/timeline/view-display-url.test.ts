/**
 * Unit tests for the display-state URL codec in
 * {@link import('../../../src/components/views/view-state-url')}.
 *
 * @remarks
 * Presentation toggles ride the URL alongside the query so a configured lens is shareable and
 * reload-stable. Two properties matter: only *non-default* options are emitted (so a default view
 * yields a clean URL), and an absent option always means the declared default rather than a third
 * "unset" state that downstream code would have to reason about.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW_DISPLAY, type ViewDisplayState } from '@/components/views/field-catalog';
import { parseViewDisplay, serializeViewDisplay } from '@/components/views/view-state-url';

/** Serialize a display state to a query string. */
function serialize(display: ViewDisplayState): string {
  const params = new URLSearchParams();
  serializeViewDisplay(display, params);
  return params.toString();
}

/** Parse a query string back to a display state. */
function parse(query: string): ViewDisplayState {
  return parseViewDisplay(new URLSearchParams(query));
}

describe('display state URL codec', () => {
  it('emits nothing for the default presentation', () => {
    expect(serialize(DEFAULT_VIEW_DISPLAY)).toBe('');
  });

  it('parses an empty query as the declared defaults', () => {
    expect(parse('')).toEqual(DEFAULT_VIEW_DISPLAY);
  });

  it('emits only the options that differ from the default', () => {
    const query = serialize({ ...DEFAULT_VIEW_DISPLAY, density: 'compact' });
    expect(query).toBe('display=density%3Acompact');
  });

  it('round-trips a fully non-default presentation', () => {
    const display: ViewDisplayState = {
      density: 'compact',
      progress: false,
      markers: false,
      scale: 'week',
    };
    expect(parse(serialize(display))).toEqual(display);
  });

  it('round-trips each boolean independently', () => {
    const noProgress: ViewDisplayState = { ...DEFAULT_VIEW_DISPLAY, progress: false };
    expect(parse(serialize(noProgress))).toEqual(noProgress);
    const noMarkers: ViewDisplayState = { ...DEFAULT_VIEW_DISPLAY, markers: false };
    expect(parse(serialize(noMarkers))).toEqual(noMarkers);
  });

  it('drops unrecognized options rather than throwing', () => {
    expect(parse('display=bogus%3A1')).toEqual(DEFAULT_VIEW_DISPLAY);
  });

  it('drops values outside the allowed set, keeping the default', () => {
    expect(parse('display=density%3Ahuge').density).toBe(DEFAULT_VIEW_DISPLAY.density);
    expect(parse('display=scale%3Afortnight').scale).toBe(DEFAULT_VIEW_DISPLAY.scale);
    expect(parse('display=progress%3Amaybe').progress).toBe(DEFAULT_VIEW_DISPLAY.progress);
  });

  it('ignores a malformed token with no separator', () => {
    expect(parse('display=density')).toEqual(DEFAULT_VIEW_DISPLAY);
  });

  it('accepts every scale value', () => {
    for (const scale of ['day', 'week', 'month', 'quarter'] as const) {
      expect(parse(`display=scale%3A${scale}`).scale).toBe(scale);
    }
  });
});
