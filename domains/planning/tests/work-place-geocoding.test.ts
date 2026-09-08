import { describe, expect, it } from 'vitest';

import {
  WorkPlaceGeocodeCandidate,
  WorkPlaceGeocodeResolve,
  WorkPlaceGeocodeResult,
  WorkPlaceGeocodeSearchQuery,
  WorkPlaceReverseGeocode,
} from '../src/contracts/work-location';

describe('saved-place geocoding contracts', () => {
  it('accepts a bounded autocomplete query and rejects extra input', () => {
    expect(WorkPlaceGeocodeSearchQuery.parse({ query: '10 Library Lane' })).toEqual({
      query: '10 Library Lane',
    });
    expect(() => WorkPlaceGeocodeSearchQuery.parse({ query: 'ab' })).toThrow();
    expect(() => WorkPlaceGeocodeSearchQuery.parse({ query: '10 Library; Lane' })).toThrow();
    expect(() =>
      WorkPlaceGeocodeSearchQuery.parse({
        query: Array.from({ length: 21 }, () => 'word').join(' '),
      }),
    ).toThrow();
    expect(() =>
      WorkPlaceGeocodeSearchQuery.parse({ query: '10 Library Lane', permanent: true }),
    ).toThrow();
  });

  it('bounds candidate and resolved coordinates', () => {
    const candidate = {
      id: 'dXJuOm1ieGFkcjo1MDA',
      address: '10 Library Lane, Las Vegas, Nevada 89101',
      latitude: 36.1716,
      longitude: -115.1391,
    };

    expect(WorkPlaceGeocodeCandidate.parse(candidate)).toEqual(candidate);
    expect(WorkPlaceGeocodeResult.parse(candidate)).toEqual(candidate);
    expect(() => WorkPlaceGeocodeCandidate.parse({ ...candidate, latitude: 91 })).toThrow();
    expect(() => WorkPlaceGeocodeResult.parse({ ...candidate, longitude: -181 })).toThrow();
  });

  it('pairs the provider identifier with the temporary display address for permanent resolution', () => {
    expect(
      WorkPlaceGeocodeResolve.parse({
        id: 'dXJuOm1ieGFkcjo1MDA',
        address: '10 Library Lane',
      }),
    ).toEqual({
      id: 'dXJuOm1ieGFkcjo1MDA',
      address: '10 Library Lane',
    });
    expect(() => WorkPlaceGeocodeResolve.parse({ id: 'dXJuOm1ieGFkcjo1MDA' })).toThrow();
  });

  it('bounds a reverse-geocoding point', () => {
    expect(WorkPlaceReverseGeocode.parse({ latitude: -90, longitude: 180 })).toEqual({
      latitude: -90,
      longitude: 180,
    });
    expect(() => WorkPlaceReverseGeocode.parse({ latitude: -90.1, longitude: 0 })).toThrow();
  });
});
