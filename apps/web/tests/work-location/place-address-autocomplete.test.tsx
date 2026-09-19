import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaceAddressAutocomplete } from '../../src/components/work-location/place-address-autocomplete';
import { problemResponse } from '../support/query';

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const libraryCandidates = {
  items: [
    { id: 'address-1', address: '10 Library Lane', latitude: 36.17, longitude: -115.14 },
    { id: 'address-2', address: '20 Library Lane', latitude: 36.18, longitude: -115.15 },
  ],
  attribution: 'Search results by Mapbox',
};

function renderPicker(onResolved = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
      <form aria-label="Place form">
        <Harness />
      </form>
      <Toaster />
    </QueryClientProvider>,
  );
}

/** Type a term, let the debounce settle, and hand the clock back to the real timers. */
async function settleSearch(term: string): Promise<void> {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: term } });
  await act(() => vi.advanceTimersByTimeAsync(400));
  await act(() => vi.runOnlyPendingTimersAsync());
  vi.useRealTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dismissAllNotices();
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

  it('presents a failed address lookup as a notice and keeps the field clean', async () => {
    // The lookup settles only once the clock is real again, so the notice stack's own timers run.
    let failLookup: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          failLookup = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    renderPicker();

    await settleSearch('Library');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      failLookup?.(problemResponse('geocoder down', 500, 'internal'));
      await Promise.resolve();
    });

    const notice = await screen.findByRole('alert');
    expect(notice).not.toHaveTextContent(/geocoder down/);
    expect(
      within(screen.getByRole('form', { name: 'Place form' })).queryByRole('alert'),
    ).toBeNull();
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('presents a failed resolution as a notice and leaves the typed address in place', async () => {
    const onResolved = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/resolutions')) {
        return Promise.resolve(problemResponse('resolver down', 500, 'internal'));
      }
      return Promise.resolve(response(libraryCandidates));
    });
    vi.stubGlobal('fetch', fetcher);
    renderPicker(onResolved);

    await settleSearch('Library');
    await screen.findAllByRole('option');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    const notice = await screen.findByRole('alert');
    expect(notice).not.toHaveTextContent(/resolver down/);
    expect(
      within(screen.getByRole('form', { name: 'Place form' })).queryByRole('alert'),
    ).toBeNull();
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('Library');
    expect(screen.getByRole('combobox')).toBeEnabled();
  });
});
