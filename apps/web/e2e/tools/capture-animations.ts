import type { Page } from '@playwright/test';

/** Wait for running entrance motion while preserving paused scroll-driven presentation. */
export async function waitForCaptureAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity),
      );
    if (running.length === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1500);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  });
}
