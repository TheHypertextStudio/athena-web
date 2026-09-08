'use client';

/** Interactive point picker for a private saved-place location. */
import { Button } from '@docket/ui/primitives';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
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

/** Render a continuously visible MapLibre picker with explicit load and selection states. */
export function PlaceMapPicker({ value, onChange }: PlaceMapPickerProps): JSX.Element {
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let loaded = false;
    let resizeObserver: ResizeObserver | null = null;
    let colorScheme: MediaQueryList | null = null;
    let updateStyle: ((event: MediaQueryListEvent) => void) | null = null;
    setMapState('loading');
    setMessage(null);

    void import('maplibre-gl')
      .then(({ Map, Marker, NavigationControl }) => {
        if (!active) return;
        const initialValue = latestValueRef.current;
        const center: [number, number] = initialValue
          ? [initialValue.longitude, initialValue.latitude]
          : [-98.5795, 39.8283];
        colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
        const map = new Map({
          container,
          style: colorScheme.matches ? DARK_STYLE : LIGHT_STYLE,
          center,
          zoom: initialValue ? 15 : 2.5,
          attributionControl: {},
        });
        mapRef.current = map;

        const createMarker = (point: PlaceMapPoint): MapLibreMarker => {
          const marker = new Marker({ draggable: true })
            .setLngLat([point.longitude, point.latitude])
            .addTo(map);
          marker.on('dragend', () => {
            const position = marker.getLngLat();
            selectPoint({ latitude: position.lat, longitude: position.lng }, 'map');
          });
          return marker;
        };
        createMarkerRef.current = createMarker;
        if (initialValue) markerRef.current = createMarker(initialValue);

        map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          loaded = true;
          setMapState(latestValueRef.current ? 'selected' : 'ready');
        });
        map.on('error', () => {
          if (!loaded) setMapState('failed');
        });
        map.on('click', (event) => {
          selectPoint({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }, 'map');
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
        if (active) setMapState('failed');
      });

    return () => {
      active = false;
      resizeObserver?.disconnect();
      if (colorScheme && updateStyle) colorScheme.removeEventListener('change', updateStyle);
      markerRef.current?.remove();
      markerRef.current = null;
      createMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [retryVersion, selectPoint]);

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

  return (
    <div className="flex flex-col gap-2">
      <div className="border-outline-variant bg-surface-container-low relative h-64 w-full overflow-hidden rounded-lg border">
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
      </div>
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
