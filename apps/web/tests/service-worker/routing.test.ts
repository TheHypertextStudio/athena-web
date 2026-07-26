import { describe, expect, it } from 'vitest';

import { routeRequest } from '../../service-worker/routing';

const ORIGIN = 'https://docket.localhost';

function route(
  url: string,
  overrides: { method?: string; isNavigation?: boolean; production?: boolean } = {},
) {
  return routeRequest({
    method: overrides.method ?? 'GET',
    url,
    origin: ORIGIN,
    isNavigation: overrides.isNavigation ?? false,
    production: overrides.production ?? true,
  });
}

describe('service worker routing', () => {
  describe('security floor', () => {
    // These are the rules that keep authenticated data out of Cache Storage entirely. Because they
    // hold, the worker needs no per-user cache partitioning and signing out on a shared device has
    // nothing to purge here. Weakening either one turns the worker into a data leak.
    it('never intercepts the typed API', () => {
      expect(route(`${ORIGIN}/v1/orgs`)).toBe('passthrough');
      expect(route(`${ORIGIN}/v1/me/notifications?unread=1`)).toBe('passthrough');
      expect(route(`${ORIGIN}/v1`)).toBe('passthrough');
    });

    it('never intercepts Better Auth traffic', () => {
      expect(route(`${ORIGIN}/api/auth/get-session`)).toBe('passthrough');
      expect(route(`${ORIGIN}/api/auth`)).toBe('passthrough');
    });

    it('does not treat a lookalike path as the API', () => {
      // `/v1x` and `/api/authz` are ordinary app routes, so the guard must key on a segment
      // boundary rather than a bare prefix. Asserted as navigations: a non-navigation request to an
      // unrecognised path is passthrough anyway, so it could not distinguish the two rules.
      expect(route(`${ORIGIN}/v1x/thing`, { isNavigation: true })).toBe('navigation');
      expect(route(`${ORIGIN}/api/authz`, { isNavigation: true })).toBe('navigation');
    });

    it('never caches a non-GET request', () => {
      expect(route(`${ORIGIN}/icons/icon-192.png`, { method: 'POST' })).toBe('passthrough');
      expect(route(`${ORIGIN}/_next/static/chunk.js`, { method: 'HEAD' })).toBe('passthrough');
    });

    it('leaves other origins alone', () => {
      expect(route('https://example.com/_next/static/chunk.js')).toBe('passthrough');
      // A same-prefix foreign origin must not be mistaken for our own.
      expect(route('https://docket.localhost.evil.com/v1/orgs')).toBe('passthrough');
    });
  });

  describe('dev server plumbing', () => {
    // Intercepting any of this breaks hot reload, which is why the worker is safe to register in
    // development and therefore testable end-to-end against the dev stack.
    it('passes through HMR and Next internals', () => {
      expect(route(`${ORIGIN}/_next/webpack-hmr`)).toBe('passthrough');
      expect(route(`${ORIGIN}/__nextjs_original-stack-frame`)).toBe('passthrough');
      expect(route(`${ORIGIN}/_next/turbopack/chunk.js`)).toBe('passthrough');
    });

    it('passes through RSC payload requests', () => {
      expect(route(`${ORIGIN}/today?_rsc=abc123`, { isNavigation: true })).toBe('passthrough');
    });

    it('passes through the image optimizer', () => {
      // It negotiates on Accept, so a URL-keyed cache would serve the wrong format.
      expect(route(`${ORIGIN}/_next/image?url=%2Ff.png&w=64`)).toBe('passthrough');
    });
  });

  describe('static assets', () => {
    it('caches immutable build output in production', () => {
      expect(route(`${ORIGIN}/_next/static/chunks/main-abc123.js`)).toBe('cache-first');
    });

    it('refuses to cache build output in development', () => {
      // Turbopack rebuilds dev chunks in place, so cache-first would serve stale code.
      expect(route(`${ORIGIN}/_next/static/chunks/main.js`, { production: false })).toBe(
        'passthrough',
      );
    });

    it('revalidates icons and the manifest in the background', () => {
      expect(route(`${ORIGIN}/icons/icon-512.png`)).toBe('stale-while-revalidate');
      expect(route(`${ORIGIN}/manifest.webmanifest`)).toBe('stale-while-revalidate');
      expect(route(`${ORIGIN}/icon.svg`)).toBe('stale-while-revalidate');
    });
  });

  describe('navigations', () => {
    it('gives documents the offline fallback', () => {
      expect(route(`${ORIGIN}/today`, { isNavigation: true })).toBe('navigation');
      expect(route(`${ORIGIN}/orgs/org_1/projects`, { isNavigation: true })).toBe('navigation');
    });

    it('ignores a non-navigation request to the same path', () => {
      expect(route(`${ORIGIN}/today`)).toBe('passthrough');
    });
  });
});
