import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mapPoint = { latitude: 36.1699, longitude: -115.1398 };
const resolvedPoint = { latitude: 36.1716, longitude: -115.1391 };

vi.mock('../../src/components/work-location/place-map-picker', () => ({
  PlaceMapPicker: ({
    value,
    onChange,
  }: {
    value: typeof mapPoint | null;
    onChange: (point: typeof mapPoint, source: 'map') => void;
  }) => (
    <button
      type="button"
      aria-label="Place map"
      data-point={value ? `${String(value.latitude)},${String(value.longitude)}` : 'none'}
      onClick={() => {
        onChange(mapPoint, 'map');
      }}
    >
      Pick library
    </button>
  ),
}));

vi.mock('../../src/components/work-location/place-address-autocomplete', () => ({
  PlaceAddressAutocomplete: ({
    value,
    onValueChange,
    onResolved,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    onResolved: (result: {
      id: string;
      address: string;
      latitude: number;
      longitude: number;
    }) => void;
  }) => (
    <label>
      Address (optional)
      <input
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          onResolved({
            id: 'local:10-library-lane',
            address: '10 Library Lane, Las Vegas, Nevada 89101',
            ...resolvedPoint,
          });
        }}
      >
        Choose address
      </button>
    </label>
  ),
}));

vi.mock('../../src/components/work-location/use-place-reverse-geocode', () => ({
  usePlaceReverseGeocode: (onResolved: (result: object) => void) => ({
    isPending: false,
    error: null,
    mutate: (point: typeof mapPoint) => {
      onResolved({
        id: 'local:map-point',
        address: '12 Library Lane, Las Vegas, Nevada 89101',
        ...point,
      });
    },
  }),
}));

import { PlaceEditorDialog } from '../../src/components/work-location/place-editor-dialog';

afterEach(cleanup);

describe('PlaceEditorDialog', () => {
  it('mounts the map immediately in a content-sized dialog without redundant disclosure copy', () => {
    render(
      <PlaceEditorDialog
        open
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Place map' })).toBeVisible();
    expect(screen.queryByText(/A name is enough/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /choose on map|hide map/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog').className).not.toContain('h-[min(80dvh,48rem)]');
  });

  it('saves a name-only place outside automatic setup', () => {
    const onSave = vi.fn();
    render(
      <PlaceEditorDialog
        open
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Train' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Train', address: null, geofence: null });
  });

  it('requires a changed address to be selected and keeps address and marker synchronized', () => {
    const onSave = vi.fn();
    render(
      <PlaceEditorDialog
        open
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Main library' } });
    fireEvent.change(screen.getByLabelText('Address (optional)'), {
      target: { value: '10 Library' },
    });
    expect(screen.getByRole('button', { name: 'Save place' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose address' }));
    expect(screen.getByRole('button', { name: 'Place map' })).toHaveAttribute(
      'data-point',
      '36.1716,-115.1391',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Main library',
      address: '10 Library Lane, Las Vegas, Nevada 89101',
      geofence: { ...resolvedPoint, radiusMeters: 250 },
    });
  });

  it('offers a reverse-geocoded replacement without overwriting the address', () => {
    render(
      <PlaceEditorDialog
        open
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Address (optional)'), {
      target: { value: 'Typed address' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Place map' }));
    expect(screen.getByLabelText('Address (optional)')).toHaveValue('Typed address');
    expect(screen.getByText('12 Library Lane, Las Vegas, Nevada 89101')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Use suggested address' }));
    expect(screen.getByLabelText('Address (optional)')).toHaveValue(
      '12 Library Lane, Las Vegas, Nevada 89101',
    );
  });

  it('keeps the current address when the reverse-geocoded replacement is rejected', () => {
    render(
      <PlaceEditorDialog
        open
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Address (optional)'), {
      target: { value: 'Typed address' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Place map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep current address' }));

    expect(screen.getByLabelText('Address (optional)')).toHaveValue('Typed address');
    expect(screen.queryByText('12 Library Lane, Las Vegas, Nevada 89101')).not.toBeInTheDocument();
  });

  it('requires a point and names the automatic-location completion action', () => {
    render(
      <PlaceEditorDialog
        open
        intent="automatic-setup"
        onOpenChange={vi.fn()}
        place={null}
        pending={false}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home' } });
    expect(screen.getByRole('button', { name: 'Save and turn on' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Place map' }));
    expect(screen.getByRole('button', { name: 'Save and turn on' })).toBeEnabled();
  });
});
