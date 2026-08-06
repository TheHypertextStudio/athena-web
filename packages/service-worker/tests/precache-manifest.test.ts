import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertWithinBudget,
  collectPrecacheAssets,
  formatBytes,
  PRECACHE_BUDGET_BYTES,
  totalBytes,
} from '../src/precache-manifest';

/**
 * The precache manifest decides how much of a person's device Docket takes, and whether a route
 * they never opened works offline. Both are worth a test.
 */

/** A throwaway `.next/static` with the given files, sized by content length. */
function fakeStatic(files: Readonly<Record<string, number>>): string {
  const root = mkdtempSync(join(tmpdir(), 'docket-precache-'));
  for (const [path, bytes] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'x'.repeat(bytes));
  }
  return root;
}

describe('collectPrecacheAssets', () => {
  it('turns every emitted file into the URL the browser will ask for', () => {
    const root = fakeStatic({ 'chunks/main.js': 10, 'media/font.woff2': 20 });

    expect(collectPrecacheAssets(root)).toEqual([
      { url: '/_next/static/chunks/main.js', bytes: 10 },
      { url: '/_next/static/media/font.woff2', bytes: 20 },
    ]);
  });

  it('descends into nested directories', () => {
    const root = fakeStatic({ 'chunks/app/(app)/today/page.js': 5 });

    expect(collectPrecacheAssets(root).map((asset) => asset.url)).toEqual([
      '/_next/static/chunks/app/(app)/today/page.js',
    ]);
  });

  it('takes stylesheets and fonts, not only scripts', () => {
    // A route that renders offline in a fallback face with no styles has not really rendered.
    const root = fakeStatic({
      'chunks/main.js': 1,
      'chunks/styles.css': 1,
      'media/plex.woff2': 1,
    });

    expect(collectPrecacheAssets(root)).toHaveLength(3);
  });

  it('is byte-stable across builds, so an unchanged manifest produces an unchanged worker', () => {
    const files = { 'chunks/b.js': 1, 'chunks/a.js': 1, 'media/c.woff2': 1 };

    expect(collectPrecacheAssets(fakeStatic(files))).toEqual(
      collectPrecacheAssets(fakeStatic(files)),
    );
  });
});

describe('assertWithinBudget', () => {
  it('passes a precache inside the budget', () => {
    const assets = [{ url: '/_next/static/chunks/main.js', bytes: 1_000 }];

    expect(() => {
      assertWithinBudget(assets, 2_000);
    }).not.toThrow();
  });

  it('fails the build rather than quietly dropping assets', () => {
    // A precache that silently shrinks is a feature that silently stops working, for someone who is
    // offline and cannot be told.
    const assets = [
      { url: '/_next/static/chunks/huge.js', bytes: 5_000 },
      { url: '/_next/static/chunks/small.js', bytes: 10 },
    ];

    expect(() => {
      assertWithinBudget(assets, 1_000);
    }).toThrow(/over the .* budget/);
  });

  it('names the largest assets so the failure is actionable', () => {
    const assets = [
      { url: '/_next/static/chunks/editor.js', bytes: 9_000 },
      { url: '/_next/static/chunks/tiny.js', bytes: 1 },
    ];

    expect(() => {
      assertWithinBudget(assets, 100);
    }).toThrow(/editor\.js/);
  });

  it('accepts an empty precache, which is what a development build produces', () => {
    expect(() => {
      assertWithinBudget([]);
    }).not.toThrow();
  });
});

describe('totalBytes and formatBytes', () => {
  it('sums the assets', () => {
    expect(
      totalBytes([
        { url: '/a', bytes: 3 },
        { url: '/b', bytes: 4 },
      ]),
    ).toBe(7);
  });

  it('reads the way a person reads sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('keeps the budget where a whole application still fits', () => {
    // The measured build is ~8.3 MB of chunks, styles and fonts. If this ever needs raising, that is
    // a decision about what every install costs, not a formality.
    expect(PRECACHE_BUDGET_BYTES).toBeGreaterThan(8.3 * 1024 * 1024);
  });
});
