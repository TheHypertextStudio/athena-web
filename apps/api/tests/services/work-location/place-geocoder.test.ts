import { describe, expect, it, vi } from 'vitest';

import {
  MapboxPlaceGeocoder,
  PlaceGeocoderUnavailable,
} from '../../../src/services/work-location/place-geocoder';

const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-115.1391, 36.1716] },
  properties: {
    mapbox_id: 'dXJuOm1ieGFkcjo1MDA',
    full_address: '10 Library Lane, Las Vegas, Nevada 89101',
    coordinates: { longitude: -115.1391, latitude: 36.1716 },
  },
};

function jsonResponse(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function firstRequestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
  const input = fetcher.mock.calls[0]?.[0];
  if (input === undefined) throw new Error('The geocoder did not call fetch');
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString());
}

describe('MapboxPlaceGeocoder', () => {
  it('encodes a temporary autocomplete search and normalizes five candidates', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: Array.from({ length: 7 }, () => feature),
      }),
    );
    const geocoder = new MapboxPlaceGeocoder({ accessToken: 'secret-token', fetcher });

    const result = await geocoder.search('10 Library Lane & Main');

    const url = firstRequestUrl(fetcher);
    expect(url.pathname).toBe('/search/geocode/v6/forward');
    expect(url.searchParams.get('q')).toBe('10 Library Lane & Main');
    expect(url.searchParams.get('autocomplete')).toBe('true');
    expect(url.searchParams.get('types')).toBe('address');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.has('permanent')).toBe(false);
    expect(result).toEqual({
      items: Array.from({ length: 5 }, () => ({
        id: 'dXJuOm1ieGFkcjo1MDA',
        address: '10 Library Lane, Las Vegas, Nevada 89101',
        latitude: 36.1716,
        longitude: -115.1391,
      })),
      attribution: 'Search results by Mapbox',
    });
  });

  it('permanently resolves the selected address and verifies its provider identifier', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type: 'FeatureCollection', features: [feature] }));
    const geocoder = new MapboxPlaceGeocoder({ accessToken: 'secret-token', fetcher });

    await expect(
      geocoder.resolve({
        id: 'dXJuOm1ieGFkcjo1MDA',
        address: '10 Library Lane, Las Vegas, Nevada 89101',
      }),
    ).resolves.toMatchObject({
      address: '10 Library Lane, Las Vegas, Nevada 89101',
      latitude: 36.1716,
      longitude: -115.1391,
    });
    const url = firstRequestUrl(fetcher);
    expect(url.pathname).toBe('/search/geocode/v6/forward');
    expect(url.searchParams.get('q')).toBe('10 Library Lane, Las Vegas, Nevada 89101');
    expect(url.searchParams.get('permanent')).toBe('true');
    expect(url.searchParams.get('autocomplete')).toBe('false');
    expect(url.searchParams.get('types')).toBe('address');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('rejects a permanent result that does not match the selected provider identifier', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: 'FeatureCollection',
        features: [
          { ...feature, properties: { ...feature.properties, mapbox_id: 'different-id' } },
        ],
      }),
    );
    const geocoder = new MapboxPlaceGeocoder({ accessToken: 'secret-token', fetcher });

    await expect(
      geocoder.resolve({ id: 'selected-id', address: '10 Library Lane' }),
    ).rejects.toBeInstanceOf(PlaceGeocoderUnavailable);
  });

  it('permanently reverse-geocodes a point in longitude-latitude order', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type: 'FeatureCollection', features: [feature] }));
    const geocoder = new MapboxPlaceGeocoder({ accessToken: 'secret-token', fetcher });

    await expect(
      geocoder.reverse({ latitude: 36.1716, longitude: -115.1391 }),
    ).resolves.toMatchObject({ address: '10 Library Lane, Las Vegas, Nevada 89101' });
    const url = firstRequestUrl(fetcher);
    expect(url.pathname).toBe('/search/geocode/v6/reverse');
    expect(url.searchParams.get('longitude')).toBe('-115.1391');
    expect(url.searchParams.get('latitude')).toBe('36.1716');
    expect(url.searchParams.get('types')).toBe('address');
    expect(url.searchParams.get('permanent')).toBe('true');
  });

  it.each([
    ['provider throttling', jsonResponse({ message: 'token secret-token exhausted' }, 429)],
    ['malformed output', jsonResponse({ features: [{ nope: true }] })],
    ['provider outage', jsonResponse({ message: 'private upstream failure' }, 503)],
  ])('maps %s to one secret-safe error', async (_label, response) => {
    const geocoder = new MapboxPlaceGeocoder({
      accessToken: 'secret-token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    const error = await geocoder.search('Library').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlaceGeocoderUnavailable);
    expect(String(error)).not.toContain('secret-token');
    expect(String(error)).not.toContain('private upstream failure');
  });

  it('times out a provider request without exposing the token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });
    const geocoder = new MapboxPlaceGeocoder({
      accessToken: 'secret-token',
      fetcher,
      timeoutMs: 5,
    });

    const error = await geocoder.search('Library').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlaceGeocoderUnavailable);
    expect(String(error)).not.toContain('secret-token');
  });
});
