import { truncateTitle } from '@docket/work/task-titles';

/**
 * Derive a task title from freeform captured text.
 *
 * @remarks
 * The first non-empty line, whitespace collapsed and length-capped. Shared by the `capture` tool,
 * `POST /capture`, and the proposal ghost projection so all three agree on what a pasted block of
 * text is called — a ghost that previews a different title from the one the write produces is
 * worse than no ghost at all.
 *
 * @param text - The captured text.
 * @returns the single-line title.
 */
export function deriveCaptureTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? text;
  return truncateTitle(firstLine.trim().replace(/\s+/g, ' '));
}
