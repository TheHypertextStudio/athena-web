import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mapPoint = { latitude: 36.1699, longitude: -115.1398 };

vi.mock('../../src/components/work-location/place-map-picker', () => ({
  PlaceMapPicker: ({
    onChange,
  }: {
    onChange: (point: { latitude: number; longitude: number }) => void;
  }) => (
    <button
      type="button"
      aria-label="Place map"
      onClick={() => {
        onChange(mapPoint);
      }}
    >
      Pick library
    </button>
  ),
}));

import { PlaceEditorDialog } from '../../src/components/work-location/place-editor-dialog';

afterEach(cleanup);

describe('PlaceEditorDialog', () => {
  it('saves a name without requiring address or location configuration', () => {
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
    expect(screen.queryByLabelText(/radius/i)).not.toBeInTheDocument();
  });

  it('keeps address optional and applies the product-owned radius to a map point', () => {
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
      target: { value: '10 Library Lane' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose on map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Main library',
      address: '10 Library Lane',
      geofence: { ...mapPoint, radiusMeters: 250 },
    });
  });
});
