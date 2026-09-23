/**
 * Unit tests for {@link parseEstimate} and {@link parseTitleEstimate}: typed time estimates become
 * whole minutes, and anything outside 0:01–99:59 is refused.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ESTIMATE_MINUTES,
  parseEstimate,
  parseTitleEstimate,
} from '../../src/lib/parse-estimate';

describe('parseEstimate', () => {
  it.each([
    ['45', 45],
    ['45m', 45],
    ['45 min', 45],
    ['45 mins', 45],
    ['90 minutes', 90],
    ['1h', 60],
    ['1 hr', 60],
    ['2 hours', 120],
    ['1.5h', 90],
    ['1h30', 90],
    ['1h 30m', 90],
    ['1H30M', 90],
    ['1:30', 90],
    ['0:05', 5],
    ['0', 0],
    ['0:00', 0],
    ['1.5', 90],
    ['.25', 15],
    ['  20m  ', 20],
    ['99:59', MAX_ESTIMATE_MINUTES],
  ])('reads %j as %i minutes', (text, minutes) => {
    expect(parseEstimate(text)).toBe(minutes);
  });

  it('rounds to whole minutes', () => {
    expect(parseEstimate('0.25h')).toBe(15);
    expect(parseEstimate('10.6m')).toBe(11);
    expect(parseEstimate('0.01')).toBe(1);
  });

  it.each(['', '   ', '-5', 'soon', 'h', 'm', '1:75', '30m 1h', '100:00', '6000', '100.5'])(
    'refuses %j',
    (text) => {
      expect(parseEstimate(text)).toBeNull();
    },
  );
});

describe('parseTitleEstimate', () => {
  it('takes a trailing token out of the title', () => {
    expect(parseTitleEstimate('Draft the brief ~45m')).toEqual({
      minutes: 45,
      title: 'Draft the brief',
    });
  });

  it('takes a token from the middle and closes the gap', () => {
    expect(parseTitleEstimate('Draft ~1:30 the brief')).toEqual({
      minutes: 90,
      title: 'Draft the brief',
    });
  });

  it('skips tokens that are not times', () => {
    expect(parseTitleEstimate('Look into ~soon then ~1h')).toEqual({
      minutes: 60,
      title: 'Look into ~soon then',
    });
  });

  it('leaves a unitless token as "about", not a time', () => {
    expect(parseTitleEstimate('Invite ~5 people to the kickoff')).toBeNull();
    expect(parseTitleEstimate('Budget ~1.5 flyers each')).toBeNull();
  });

  it('ignores a tilde inside a word', () => {
    expect(parseTitleEstimate('Compare a~30m')).toBeNull();
  });

  it('returns null when there is no token', () => {
    expect(parseTitleEstimate('Draft the brief')).toBeNull();
  });
});
