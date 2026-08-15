'use client';

/** Lazy interactive point picker for a private saved-place location. */
import { Button } from '@docket/ui/primitives';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

/** One private point selected by the owner. */
export interface PlaceMapPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** Props for {@link PlaceMapPicker}. */
export interface PlaceMapPickerProps {
  /** Existing or newly selected point. */
  readonly value: PlaceMapPoint | null;
  /** Receive a point selected on the map or from the current-position action. */
  readonly onChange: (point: PlaceMapPoint) => void;
}

/**
 * Render MapLibre only after the editor discloses the map.
 *
 * @remarks
 * OpenFreeMap supplies the basemap without an API key. Coordinates remain in this editor until the
 * owner saves the place; the map does not geocode or transmit the optional address.
 */
export function PlaceMapPicker({ value, onChange }: PlaceMapPickerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const initialValueRef = useRef(value);
  const [status, setStatus] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setMarker = useCallback((point: PlaceMapPoint): void => {
    const marker = markerRef.current;
    if (marker) marker.setLngLat([point.longitude, point.latitude]);
    mapRef.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 15 });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let active = true;
    void import('maplibre-gl').then(({ Map, Marker, NavigationControl }) => {
      if (!active || !containerRef.current) return;
      const initialValue = initialValueRef.current;
      const center: [number, number] = initialValue
        ? [initialValue.longitude, initialValue.latitude]
        : [-98.5795, 39.8283];
      const map = new Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/positron',
        center,
        zoom: initialValue ? 15 : 2.5,
        attributionControl: {},
      });
      const addMarker = (point: [number, number]): MapLibreMarker => {
        const marker = new Marker({ draggable: true }).setLngLat(point).addTo(map);
        marker.on('dragend', () => {
          const position = marker.getLngLat();
          onChangeRef.current({ latitude: position.lat, longitude: position.lng });
          setStatus('Map location selected.');
        });
        return marker;
      };
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      map.on('click', (event) => {
        const point = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
        if (!markerRef.current) {
          markerRef.current = addMarker([event.lngLat.lng, event.lngLat.lat]);
        } else markerRef.current.setLngLat(event.lngLat);
        onChangeRef.current(point);
        setStatus('Map location selected.');
      });
      mapRef.current = map;
      markerRef.current = initialValue ? addMarker(center) : null;
    });
    return () => {
      active = false;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (value) setMarker(value);
  }, [setMarker, value]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        role="region"
        aria-label="Place map"
        className="border-outline-variant bg-surface-container-low h-64 w-full overflow-hidden rounded-lg border"
      />
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2">
        <p className="text-on-surface-variant text-body-small" role="status">
          {status ?? (value ? 'Map location selected.' : 'Click the map to choose a location.')}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (!('geolocation' in navigator)) {
              setStatus('This browser does not offer location access.');
              return;
            }
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const point = {
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                };
                onChange(point);
                setMarker(point);
                setStatus('Using this device’s current position.');
              },
              () => {
                setStatus('This browser could not use the current position.');
              },
            );
          }}
        >
          Use current position
        </Button>
      </div>
    </div>
  );
}
