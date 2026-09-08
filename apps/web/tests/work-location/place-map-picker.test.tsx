import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { lngLat: { lng: number; lat: number } }) => void;

const runtime = vi.hoisted(() => ({
  dark: false,
  maps: [] as FakeMap[],
  markers: [] as FakeMarker[],
  resizeCallbacks: [] as (() => void)[],
}));

class FakeMap {
  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, Listener[]>();
  readonly resize = vi.fn();
  readonly remove = vi.fn();
  readonly easeTo = vi.fn();
  readonly setStyle = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    runtime.maps.push(this);
  }

  readonly addControl = vi.fn();

  on(name: string, listener: Listener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  emit(name: string, event = { lngLat: { lng: -115.14, lat: 36.17 } }): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class FakeMarker {
  readonly setLngLat = vi.fn(() => this);
  readonly addTo = vi.fn(() => this);
  readonly remove = vi.fn();
  readonly listeners = new Map<string, () => void>();
  position = { lng: -115.14, lat: 36.17 };

  constructor() {
    runtime.markers.push(this);
  }

  on(name: string, listener: () => void): this {
    this.listeners.set(name, listener);
    return this;
  }

  getLngLat(): { lng: number; lat: number } {
    return this.position;
  }
}

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {
    readonly kind = 'navigation';
  },
}));

import { PlaceMapPicker } from '../../src/components/work-location/place-map-picker';

beforeEach(() => {
  runtime.dark = false;
  runtime.maps.length = 0;
  runtime.markers.length = 0;
  runtime.resizeCallbacks.length = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: runtime.dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();

      constructor(callback: () => void) {
        runtime.resizeCallbacks.push(callback);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlaceMapPicker', () => {
  it('mounts immediately with the light style and reports readiness', async () => {
    render(<PlaceMapPicker value={null} onChange={vi.fn()} />);

    expect(await screen.findByRole('region', { name: 'Place map' })).toHaveAttribute(
      'data-map-state',
      'loading',
    );
    expect(runtime.maps[0]?.options['style']).toBe('https://tiles.openfreemap.org/styles/positron');
    act(() => runtime.maps[0]?.emit('load'));
    expect(await screen.findByRole('region', { name: 'Place map' })).toHaveAttribute(
      'data-map-state',
      'ready',
    );
  });

  it('uses OpenFreeMap Dark when the browser prefers dark mode', async () => {
    runtime.dark = true;
    render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
    await screen.findByRole('region', { name: 'Place map' });
    expect(runtime.maps[0]?.options['style']).toBe('https://tiles.openfreemap.org/styles/dark');
  });

  it('shows application-owned load recovery and retries with a new map', async () => {
    render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
    await screen.findByRole('region', { name: 'Place map' });
    act(() => runtime.maps[0]?.emit('error'));

    expect(await screen.findByText('Docket could not load the map.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(runtime.maps).toHaveLength(2);
    });
  });

  it('creates a marker for a value that arrives after map startup', async () => {
    const { rerender } = render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
    await screen.findByRole('region', { name: 'Place map' });
    rerender(
      <PlaceMapPicker value={{ latitude: 36.1716, longitude: -115.1391 }} onChange={vi.fn()} />,
    );
    expect(runtime.markers).toHaveLength(1);
    expect(runtime.markers[0]?.setLngLat).toHaveBeenCalledWith([-115.1391, 36.1716]);
  });

  it('uses one selection path for map clicks and marker dragging', async () => {
    const onChange = vi.fn();
    render(<PlaceMapPicker value={null} onChange={onChange} />);
    await screen.findByRole('region', { name: 'Place map' });
    act(() => runtime.maps[0]?.emit('click', { lngLat: { lng: -115.141, lat: 36.1699 } }));
    expect(onChange).toHaveBeenCalledWith({ latitude: 36.1699, longitude: -115.141 }, 'map');

    const marker = runtime.markers[0];
    if (!marker) throw new Error('Expected a map marker');
    marker.position = { lng: -115.15, lat: 36.18 };
    act(() => marker.listeners.get('dragend')?.());
    expect(onChange).toHaveBeenLastCalledWith({ latitude: 36.18, longitude: -115.15 }, 'map');
  });

  it('keeps MapLibre sized to the animated dialog container', async () => {
    render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
    await screen.findByRole('region', { name: 'Place map' });
    act(() => runtime.resizeCallbacks[0]?.());
    expect(runtime.maps[0]?.resize).toHaveBeenCalledOnce();
  });

  it('selects the current position through the shared marker path', async () => {
    const onChange = vi.fn();
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({ coords: { latitude: 36.2, longitude: -115.2 } } as GeolocationPosition);
        },
      },
    });
    render(<PlaceMapPicker value={null} onChange={onChange} />);
    await screen.findByRole('region', { name: 'Place map' });
    fireEvent.click(screen.getByRole('button', { name: 'Use current position' }));

    expect(runtime.markers).toHaveLength(1);
    expect(onChange).toHaveBeenCalledWith(
      { latitude: 36.2, longitude: -115.2 },
      'current-position',
    );
  });

  it.each([
    [1, 'Location permission is off. Allow it in this browser’s site settings, then try again.'],
    [2, 'This browser could not determine your current position.'],
    [3, 'This browser did not get a current position in time. Try again.'],
  ])('preserves geolocation error category %s', async (code, copy) => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => {
          failure({ code } as GeolocationPositionError);
        },
      },
    });
    render(<PlaceMapPicker value={null} onChange={vi.fn()} />);
    await screen.findByRole('region', { name: 'Place map' });
    fireEvent.click(screen.getByRole('button', { name: 'Use current position' }));
    expect(await screen.findByText(copy)).toBeVisible();
  });
});
