let sweepRequested = false;
let sweepRunning = false;

async function drainRequestedNotionMirrorSweeps(): Promise<void> {
  try {
    const { sweepNotionMirror } = await import('../routes/notion-mirror-reconcile');
    while (sweepRequested) {
      sweepRequested = false;
      await sweepNotionMirror(new Date());
    }
  } catch (error) {
    console.warn('Immediate Notion mirror sweep failed', error);
  } finally {
    sweepRunning = false;
    if (sweepRequested) requestNotionMirrorSweep();
  }
}

/** Coalesce process-local signals into an immediate background sweep. */
export function requestNotionMirrorSweep(): void {
  sweepRequested = true;
  if (sweepRunning) return;
  sweepRunning = true;
  queueMicrotask(() => void drainRequestedNotionMirrorSweeps());
}
