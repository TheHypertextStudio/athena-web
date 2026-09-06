/**
 * `@docket/api` — the Docket mark on the API's own origin, and the MCP identity that points at it.
 *
 * @remarks
 * Docket drew as a placeholder while `serverInfo.icons` looked correct. A client resolves the icon
 * in two places and neither reached the artwork: `/favicon.ico`, which answered 405, and
 * `serverInfo.icons`, which named the web origin while this server answers on the API origin.
 *
 * The second is asserted by fetching every advertised `src`, so an icon URL cannot outlive its
 * route. That is what the previous, shipped-and-did-nothing version of this fix would have failed.
 */
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { brandIcons, SERVED_ICONS } from '../../src/routes/brand-icons';
import { serverInfo } from '../../src/mcp/server';
import { API_TEST_ENV } from '../support/env';
import '../support/auth-mock';

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

it('opens every served icon to any origin', async () => {
  // `cors.ts` restates these paths rather than importing them, so that its policy reads without
  // following an import. Nothing else notices when the two lists drift apart.
  const source = await readFile(new URL('../../src/cors.ts', import.meta.url), 'utf8');
  const declared = source.slice(
    source.indexOf('PUBLIC_ICON_PATHS'),
    source.indexOf('];', source.indexOf('PUBLIC_ICON_PATHS')),
  );
  for (const icon of SERVED_ICONS) {
    expect(declared, `${icon.path} is public in cors.ts`).toContain(`'${icon.path}'`);
  }
});

it('answers /favicon.ico with an icon rather than a Problem document', async () => {
  // The regression this module exists for. A client drawing a connector card holds no token yet,
  // so this URL is the only image it can ask for.
  const res = await brandIcons.request('/favicon.ico');
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toBe('image/x-icon');
  // A zero reserved field, then type 1 — an icon rather than a cursor.
  expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4)).toEqual(
    Buffer.from([0x00, 0x00, 0x01, 0x00]),
  );
});

describe('the advertised MCP identity', () => {
  // Derived from the object Vitest builds the environment out of, not restated as a literal.
  const apiOrigin = new URL(API_TEST_ENV.API_URL).origin;
  // Optional on the SDK's `Implementation`; empty here makes the mime-type assertion fail rather
  // than the loop pass vacuously.
  const icons = serverInfo().icons ?? [];

  it('advertises PNGs on its own origin, and answers every one of them', async () => {
    // Only PNGs: a client MUST support `image/png` and nothing obliges it to decode the `.ico`
    // served above for the pre-connection guess.
    expect(icons.map((icon) => icon.mimeType)).toEqual(['image/png', 'image/png']);

    for (const icon of icons) {
      expect(new URL(icon.src).origin, icon.src).toBe(apiOrigin);
      const res = await brandIcons.request(new URL(icon.src).pathname);
      expect(res.status, icon.src).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    }
  });
});
