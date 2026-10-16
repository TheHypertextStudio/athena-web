import type { Page } from '@playwright/test';
import { afterEach, expect, it, vi } from 'vitest';
import { waitForCaptureAnimations } from '../../e2e/tools/capture-animations';

const page = { evaluate: async (callback: () => Promise<void>) => callback() } as unknown as Page;
afterEach(() => vi.unstubAllGlobals());

it('waits for entrance motion without advancing paused scroll-driven or infinite animations', async () => {
  let settled = false;
  let finish: () => void = () => {
    throw new Error('Animation not initialized');
  };
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const paused = {
    playState: 'paused',
    get finished() {
      throw new Error('Scroll presentation must stay paused');
    },
  };
  const infinite = {
    playState: 'running',
    effect: { getComputedTiming: () => ({ endTime: Infinity }) },
    get finished() {
      throw new Error('Do not wait for loading loops');
    },
  };
  const entrance = {
    playState: 'running',
    effect: { getComputedTiming: () => ({ endTime: 240 }) },
    finished,
  };
  vi.stubGlobal('document', { getAnimations: () => [paused, infinite, entrance] });
  const capture = waitForCaptureAnimations(page).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  finish();
  await capture;
  expect(settled).toBe(true);
});

it('allows a canceled entrance animation to finish capture', async () => {
  vi.stubGlobal('document', {
    getAnimations: () => [
      {
        playState: 'running',
        effect: { getComputedTiming: () => ({ endTime: 240 }) },
        finished: Promise.reject(new Error('Canceled')),
      },
    ],
  });
  await expect(waitForCaptureAnimations(page)).resolves.toBeUndefined();
});
