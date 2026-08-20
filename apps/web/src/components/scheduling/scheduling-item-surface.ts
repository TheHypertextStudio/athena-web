/** Return the solid calendar color used for an event, with a semantic fallback. */
export function scheduleEventFill(color?: string): string {
  return color === undefined || color.trim().length === 0 ? 'var(--color-primary)' : color;
}

/** Return the quiet translucent fill used for a provisional timebox. */
export function scheduleTimeboxFill(color?: string): string {
  const source = color === undefined || color.trim().length === 0 ? 'var(--color-primary)' : color;
  return `color-mix(in oklab, ${source} 14%, transparent)`;
}

/** Return a low-emphasis fill for computed availability. */
export function scheduleAvailabilityFill(color?: string): string {
  const source = color === undefined || color.trim().length === 0 ? 'var(--color-tertiary)' : color;
  return `color-mix(in oklab, ${source} 9%, transparent)`;
}

/** Return a neutral low-emphasis fill for redacted busy time. */
export function scheduleBusyFill(): string {
  return 'color-mix(in oklab, var(--color-on-surface) 7%, transparent)';
}
