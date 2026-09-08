import type {
  WorkPlaceGeocodeResult,
  WorkPlaceGeocodeResolve,
  WorkPlaceGeocodeSearchOut,
  WorkPlaceReverseGeocode,
} from '@docket/planning/work-location-contract';
import { z } from 'zod';

const MAPBOX_GEOCODING_BASE = 'https://api.mapbox.com/search/geocode/v6';
const MAPBOX_ATTRIBUTION = 'Search results by Mapbox';

const MapboxFeature = z
  .object({
    geometry: z
      .object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
      })
      .loose(),
    properties: z
      .object({
        mapbox_id: z.string().min(1),
        full_address: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        place_formatted: z.string().min(1).optional(),
        coordinates: z.object({ longitude: z.number(), latitude: z.number() }).loose().optional(),
      })
      .loose(),
  })
  .loose();

const MapboxFeatureCollection = z.object({ features: z.array(MapboxFeature) }).loose();

/** Product boundary for temporary and permanent saved-place geocoding. */
export interface PlaceGeocoder {
  /** Return temporary autocomplete candidates for one address query. */
  search(query: string): Promise<WorkPlaceGeocodeSearchOut>;
  /** Permanently resolve the provider id that the owner selected. */
  resolve(candidate: WorkPlaceGeocodeResolve): Promise<WorkPlaceGeocodeResult>;
  /** Permanently resolve an address suggestion for one owner-selected point. */
  reverse(point: WorkPlaceReverseGeocode): Promise<WorkPlaceGeocodeResult>;
}

/** Stable internal failure raised for every unusable provider response. */
export class PlaceGeocoderUnavailable extends Error {
  constructor() {
    super('The place geocoder is unavailable');
    this.name = 'PlaceGeocoderUnavailable';
  }
}

/** Construction options for {@link MapboxPlaceGeocoder}. */
export interface MapboxPlaceGeocoderOptions {
  readonly accessToken: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

function normalizedAddress(feature: z.infer<typeof MapboxFeature>): string | null {
  if (feature.properties.full_address) return feature.properties.full_address;
  const address = [feature.properties.name, feature.properties.place_formatted]
    .filter((value): value is string => Boolean(value))
    .join(', ');
  return address.length > 0 ? address : null;
}

function normalizeFeature(feature: z.infer<typeof MapboxFeature>): WorkPlaceGeocodeResult | null {
  const address = normalizedAddress(feature);
  const longitude = feature.properties.coordinates?.longitude ?? feature.geometry.coordinates[0];
  const latitude = feature.properties.coordinates?.latitude ?? feature.geometry.coordinates[1];
  if (
    !address ||
    address.length > 240 ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return { id: feature.properties.mapbox_id, address, latitude, longitude };
}

/** Mapbox Geocoding v6 adapter with a server-held credential. */
export class MapboxPlaceGeocoder implements PlaceGeocoder {
  readonly #accessToken: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: MapboxPlaceGeocoderOptions) {
    this.#accessToken = options.accessToken;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  async #request(path: 'forward' | 'reverse', parameters: URLSearchParams) {
    parameters.set('access_token', this.#accessToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    try {
      const url = `${MAPBOX_GEOCODING_BASE}/${path}?${parameters.toString()}`;
      const response = await this.#fetcher(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new PlaceGeocoderUnavailable();
      const parsed = MapboxFeatureCollection.safeParse(await response.json());
      if (!parsed.success) throw new PlaceGeocoderUnavailable();
      return parsed.data.features;
    } catch (error) {
      if (error instanceof PlaceGeocoderUnavailable) throw error;
      throw new PlaceGeocoderUnavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string): Promise<WorkPlaceGeocodeSearchOut> {
    const features = await this.#request(
      'forward',
      new URLSearchParams({ q: query, autocomplete: 'true', types: 'address', limit: '5' }),
    );
    return {
      items: features
        .flatMap((feature) => {
          const normalized = normalizeFeature(feature);
          return normalized ? [normalized] : [];
        })
        .slice(0, 5),
      attribution: MAPBOX_ATTRIBUTION,
    };
  }

  async resolve(candidate: WorkPlaceGeocodeResolve): Promise<WorkPlaceGeocodeResult> {
    const features = await this.#request(
      'forward',
      new URLSearchParams({
        q: candidate.address,
        autocomplete: 'false',
        types: 'address',
        limit: '5',
        permanent: 'true',
      }),
    );
    const selected = features.find((feature) => feature.properties.mapbox_id === candidate.id);
    const result = selected ? normalizeFeature(selected) : null;
    if (!result) throw new PlaceGeocoderUnavailable();
    return result;
  }

  async reverse(point: WorkPlaceReverseGeocode): Promise<WorkPlaceGeocodeResult> {
    const features = await this.#request(
      'reverse',
      new URLSearchParams({
        longitude: String(point.longitude),
        latitude: String(point.latitude),
        types: 'address',
        limit: '1',
        permanent: 'true',
      }),
    );
    const result = features[0] ? normalizeFeature(features[0]) : null;
    if (!result) throw new PlaceGeocoderUnavailable();
    return result;
  }
}

const LOCAL_RESULT: WorkPlaceGeocodeResult = {
  id: 'local:10-library-lane',
  address: '10 Library Lane, Las Vegas, Nevada 89101',
  latitude: 36.1716,
  longitude: -115.1391,
};

/** Deterministic geocoder used by local development and automated tests. */
export class DeterministicPlaceGeocoder implements PlaceGeocoder {
  async search(query: string): Promise<WorkPlaceGeocodeSearchOut> {
    return {
      items: query.trim().length >= 3 ? [LOCAL_RESULT] : [],
      attribution: MAPBOX_ATTRIBUTION,
    };
  }

  async resolve(candidate: WorkPlaceGeocodeResolve): Promise<WorkPlaceGeocodeResult> {
    if (candidate.id !== LOCAL_RESULT.id || candidate.address !== LOCAL_RESULT.address) {
      throw new PlaceGeocoderUnavailable();
    }
    return LOCAL_RESULT;
  }

  async reverse(point: WorkPlaceReverseGeocode): Promise<WorkPlaceGeocodeResult> {
    return { ...LOCAL_RESULT, latitude: point.latitude, longitude: point.longitude };
  }
}
