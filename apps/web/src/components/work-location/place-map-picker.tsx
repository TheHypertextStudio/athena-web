'use client';

/** Interactive point picker for a private saved-place location. */
import { Button, Surface } from '@docket/ui/primitives';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import {
  type Dispatch,
  type JSX,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';

/** One private point selected by the owner. */
export interface PlaceMapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** The user action that selected a point. */
export type PlaceMapSelectionSource = 'map' | 'current-position';

/** Props for {@link PlaceMapPicker}. */
export interface PlaceMapPickerProps {
  /** Existing or newly selected point. */
  readonly value: PlaceMapPoint | null;
  /** Receive a point selected on the map or from the current-position action. */
  readonly onChange: (point: PlaceMapPoint, source: PlaceMapSelectionSource) => void;
}

type MapState = 'loading' | 'ready' | 'failed' | 'selected';

function geolocationErrorCopy(code: number): string {
  if (code === 1) {
    return 'Location permission is off. Allow it in this browser’s site settings, then try again.';
  }
  if (code === 3) return 'This browser did not get a current position in time. Try again.';
  return 'This browser could not determine your current position.';
}

interface MapLifecycleInput {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly mapRef: RefObject<MapLibreMap | null>;
  readonly markerRef: RefObject<MapLibreMarker | null>;
  readonly createMarkerRef: RefObject<((point: PlaceMapPoint) => MapLibreMarker) | null>;
  readonly latestValueRef: RefObject<PlaceMapPoint | null>;
  readonly retryVersion: number;
  readonly selectPoint: (point: PlaceMapPoint, source: PlaceMapSelectionSource) => void;
  readonly setMapState: Dispatch<SetStateAction<MapState>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
}

function useMapLifecycle(input: MapLifecycleInput): void {
  useEffect(() => {
    const container = input.containerRef.current;
    if (!container) return;
    let active = true;
    let loaded = false;
    let resizeObserver: ResizeObserver | null = null;
    let colorScheme: MediaQueryList | null = null;
    let updateStyle: ((event: MediaQueryListEvent) => void) | null = null;
    input.setMapState('loading');
    input.setMessage(null);

    void import('maplibre-gl')
      .then(({ Map, Marker, NavigationControl }) => {
        if (!active) return;
        const initialValue = input.latestValueRef.current;
        const center: [number, number] = initialValue
          ? [initialValue.longitude, initialValue.latitude]
          : [-98.5795, 39.8283];
        colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
        const map = new Map({
          container,
          style: colorScheme.matches ? DARK_STYLE : LIGHT_STYLE,
          center,
          zoom: initialValue ? 15 : 2.5,
          attributionControl: false,
        });
        input.mapRef.current = map;

        const createMarker = (point: PlaceMapPoint): MapLibreMarker => {
          const marker = new Marker({ draggable: true })
            .setLngLat([point.longitude, point.latitude])
            .addTo(map);
          marker.on('dragend', () => {
            const position = marker.getLngLat();
            input.selectPoint({ latitude: position.lat, longitude: position.lng }, 'map');
          });
          return marker;
        };
        input.createMarkerRef.current = createMarker;
        if (initialValue) input.markerRef.current = createMarker(initialValue);

        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          loaded = true;
          input.setMapState(input.latestValueRef.current ? 'selected' : 'ready');
        });
        map.on('error', () => {
          if (!loaded) input.setMapState('failed');
        });
        map.on('click', (event) => {
          input.selectPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }, 'map');
        });

        updateStyle = (event: MediaQueryListEvent): void => {
          map.setStyle(event.matches ? DARK_STYLE : LIGHT_STYLE);
        };
        colorScheme.addEventListener('change', updateStyle);
        if ('ResizeObserver' in window) {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(container);
        }
      })
      .catch(() => {
        if (active) input.setMapState('failed');
      });

    return () => {
      active = false;
      resizeObserver?.disconnect();
      if (colorScheme && updateStyle) colorScheme.removeEventListener('change', updateStyle);
      input.markerRef.current?.remove();
      input.markerRef.current = null;
      input.createMarkerRef.current = null;
      input.mapRef.current?.remove();
      input.mapRef.current = null;
    };
  }, [input]);
}

function useMapRuntime(value: PlaceMapPoint | null, onChange: PlaceMapPickerProps['onChange']) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const createMarkerRef = useRef<((point: PlaceMapPoint) => MapLibreMarker) | null>(null);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mapState, setMapState] = useState<MapState>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  const moveMarker = useCallback((point: PlaceMapPoint): void => {
    if (!mapRef.current) return;
    if (!markerRef.current && createMarkerRef.current) {
      markerRef.current = createMarkerRef.current(point);
    } else {
      markerRef.current?.setLngLat([point.longitude, point.latitude]);
    }
    mapRef.current.easeTo({ center: [point.longitude, point.latitude], zoom: 15 });
    setMapState('selected');
  }, []);
  const selectPoint = useCallback(
    (point: PlaceMapPoint, source: PlaceMapSelectionSource): void => {
      moveMarker(point);
      onChangeRef.current(point, source);
      setMessage(null);
    },
    [moveMarker],
  );
  const lifecycle = useMemo(
    () => ({
      containerRef,
      mapRef,
      markerRef,
      createMarkerRef,
      latestValueRef,
      retryVersion,
      selectPoint,
      setMapState,
      setMessage,
    }),
    [retryVersion, selectPoint],
  );
  useMapLifecycle(lifecycle);

  useEffect(() => {
    if (value) moveMarker(value);
  }, [moveMarker, value]);

  const useCurrentPosition = (): void => {
    if (!('geolocation' in navigator)) {
      setMessage('This browser does not provide location access.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        selectPoint(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          'current-position',
        );
      },
      (error) => {
        setMessage(geolocationErrorCopy(error.code));
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
    );
  };

  return { containerRef, mapState, message, setRetryVersion, useCurrentPosition };
}

/** Render a continuously visible MapLibre picker with explicit load and selection states. */
export function PlaceMapPicker({ value, onChange }: PlaceMapPickerProps): JSX.Element {
  const { containerRef, mapState, message, setRetryVersion, useCurrentPosition } = useMapRuntime(
    value,
    onChange,
  );

  return (
    <div className="flex flex-col gap-2">
      <Surface tone="card" shape="small" className="relative h-64 w-full overflow-hidden">
        <div
          ref={containerRef}
          role="region"
          aria-label="Place map"
          data-map-state={mapState}
          className="size-full"
        />
        {mapState === 'loading' ? (
          <p className="bg-surface/80 text-on-surface-variant text-body-small absolute inset-0 grid place-items-center">
            Loading map…
          </p>
        ) : null}
        {mapState === 'failed' ? (
          <div className="bg-surface/95 absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-on-surface text-body-medium">Docket could not load the map.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRetryVersion((current) => current + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
        <p
          aria-label="Map data attribution"
          className="bg-surface/85 text-on-surface-variant text-label-small rounded-corner-xs absolute right-1 bottom-1 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 whitespace-nowrap backdrop-blur-sm"
        >
          <span aria-hidden="true">©</span>
          <a className="underline-offset-2 hover:underline" href="https://openmaptiles.org/">
            OpenMapTiles
          </a>
          <span aria-hidden="true">· ©</span>
          <a
            className="underline-offset-2 hover:underline"
            href="https://www.openstreetmap.org/copyright"
          >
            OpenStreetMap
          </a>
        </p>
      </Surface>
      <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">
        {message !== null || !value ? (
          <p className="text-on-surface-variant text-body-small mr-auto" role="status">
            {message ?? 'Click the map to choose a location.'}
          </p>
        ) : null}
        <Button type="button" variant="ghost" onClick={useCurrentPosition}>
          Use current position
        </Button>
      </div>
    </div>
  );
}
