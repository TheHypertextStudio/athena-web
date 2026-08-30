/** Node 24 lookup-contract coverage for the real pinned HTTPS request adapter. */
import { EventEmitter } from 'node:events';

import { beforeEach, expect, it, vi } from 'vitest';

const lookupResults = vi.hoisted(() => [] as unknown[]);

vi.mock('node:https', () => ({
  request: vi.fn((_url: URL, options: Record<string, unknown>) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      write: (_body: Uint8Array) => void;
    };
    request.write = () => undefined;
    request.end = () => {
      const lookup = options['lookup'] as (
        hostname: string,
        lookupOptions: { readonly all: boolean },
        callback: (error: Error | null, address: unknown, family?: number) => void,
      ) => void;
      lookup('public.example', { all: true }, (error, address, family) => {
        lookupResults.push({ error, address, family });
      });
      request.emit('error', new Error('stop after lookup'));
    };
    return request;
  }),
}));

import { createMcpSafeFetch, type McpDnsLookup } from '../../src/mcp-network';

const publicLookup: McpDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

beforeEach(() => {
  lookupResults.length = 0;
});

it('returns a pinned address in the all-address shape requested by Node 24', async () => {
  await expect(
    createMcpSafeFetch({ lookup: publicLookup })('https://public.example/mcp'),
  ).rejects.toThrow('stop after lookup');

  expect(lookupResults).toEqual([
    {
      error: null,
      address: [{ address: '93.184.216.34', family: 4 }],
      family: undefined,
    },
  ]);
});
