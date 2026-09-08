import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaceAddressAutocomplete } from '../../src/components/work-location/place-address-autocomplete';

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPicker(onResolved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [value, setValue] = React.useState('');
    return (
      <PlaceAddressAutocomplete
        value={value}
        onValueChange={setValue}
        onResolved={(result) => {
          onResolved(result);
          setValue(result.address);
        }}
      />
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PlaceAddressAutocomplete', () => {
  it('waits 400 milliseconds, requires three characters, and shows no more than five results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        items: Array.from({ length: 5 }, (_, index) => ({
          id: `address-${String(index)}`,
          address: `${String(index + 1)} Library Lane`,
          latitude: 36.17,
          longitude: -115.14,
        })),
        attribution: 'Search results by Mapbox',
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    renderPicker();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Li' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetcher).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Library' } });
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(fetcher).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(() => vi.runOnlyPendingTimersAsync());
    vi.useRealTimers();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByRole('option')).toHaveLength(5);
    expect(screen.getByText('Search results by Mapbox')).toBeVisible();
  });

  it('permanently resolves the keyboard-selected result', async () => {
    const onResolved = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/resolutions')) {
        return Promise.resolve(
          response({
            id: 'address-2',
            address: '20 Library Lane, Las Vegas, Nevada 89101',
            latitude: 36.18,
            longitude: -115.15,
          }),
        );
      }
      return Promise.resolve(
        response({
          items: [
            {
              id: 'address-1',
              address: '10 Library Lane',
              latitude: 36.17,
              longitude: -115.14,
            },
            {
              id: 'address-2',
              address: '20 Library Lane',
              latitude: 36.18,
              longitude: -115.15,
            },
          ],
          attribution: 'Search results by Mapbox',
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    renderPicker(onResolved);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Library' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(() => vi.runOnlyPendingTimersAsync());
    vi.useRealTimers();
    await screen.findAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('20 Library Lane');
    await act(() => Promise.resolve());

    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = fetcher.mock.calls[1]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON resolve request body');
    expect(JSON.parse(body)).toEqual({
      id: 'address-2',
      address: '20 Library Lane',
    });
    expect(onResolved).toHaveBeenCalledWith({
      id: 'address-2',
      address: '20 Library Lane, Las Vegas, Nevada 89101',
      latitude: 36.18,
      longitude: -115.15,
    });
    expect(screen.getByRole('combobox')).toHaveValue('20 Library Lane, Las Vegas, Nevada 89101');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('hides results from the prior term while the next search settles', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      const address = url.includes('Museum') ? '1 Museum Way' : '10 Library Lane';
      return Promise.resolve(
        response({
          items: [{ id: address, address, latitude: 36.17, longitude: -115.14 }],
          attribution: 'Search results by Mapbox',
        }),
      );
    });
    vi.stubGlobal('fetch', fetcher);
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'Library' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(() => vi.runOnlyPendingTimersAsync());
    vi.useRealTimers();
    expect(await screen.findByText('10 Library Lane')).toBeVisible();

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'Museum' } });
    expect(screen.queryByText('10 Library Lane')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(() => vi.runOnlyPendingTimersAsync());
    vi.useRealTimers();
    expect(await screen.findByText('1 Museum Way')).toBeVisible();
  });

  it('accepts a programmatic address replacement without restarting search', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const [value, setValue] = React.useState('10 Library Lane');
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setValue('20 Museum Way');
            }}
          >
            Accept replacement
          </button>
          <PlaceAddressAutocomplete value={value} onValueChange={setValue} onResolved={vi.fn()} />
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accept replacement' }));
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(screen.getByRole('combobox')).toHaveValue('20 Museum Way');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
