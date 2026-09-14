/** `agent/tool-call-summary` — the one-line headline a tool call gets in the activity feed. */

/** Turn a `snake_case` tool identifier into a lowercase phrase, e.g. `update_task` → `update task`. */
export function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Build a human-readable one-line summary for a tool call (the UI's action headline). */
export function summarizeToolCall(name: string, input: unknown): string {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const title = typeof obj['title'] === 'string' ? obj['title'] : undefined;
  const phrase = humanizeToolName(name);
  return title ? `${phrase}: "${title}"` : phrase;
}
