/** Frozen0151 JSON format; future domain defaults must never alter historical publications. */
export interface HistoricalTemplateDefinition {
  readonly name: string;
  readonly description: string | null;
  readonly icon:
    | { readonly kind: 'symbol'; readonly name: string }
    | { readonly kind: 'emoji'; readonly hexcode: string }
    | null;
  readonly defaultStatusKey: string | null;
  readonly payload: HistoricalTemplatePayload;
}

/** Original reusable starting fields, deliberately excluding later blueprint and Task defaults. */
export interface HistoricalTemplatePayload {
  readonly targetType: 'initiative' | 'program' | 'project' | 'task';
  readonly [key: string]: unknown;
}

const TEXT_FIELDS = {
  task: ['title', 'description'],
  project: ['name', 'summary', 'description', 'status'],
  program: ['name', 'summary', 'description', 'status'],
  initiative: ['name', 'summary', 'description', 'status'],
} as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid historical template object.');
  return value as Record<string, unknown>;
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid historical template text.');
  return value;
}

function glyph(value: unknown): HistoricalTemplateDefinition['icon'] {
  if (value === undefined || value === null) return null;
  const input = object(value);
  if (
    input['kind'] === 'symbol' &&
    typeof input['name'] === 'string' &&
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(input['name'])
  )
    return { kind: 'symbol', name: input['name'] };
  if (
    input['kind'] === 'emoji' &&
    typeof input['hexcode'] === 'string' &&
    /^[0-9A-F]{2,6}(?:-[0-9A-F]{2,6})*$/.test(input['hexcode'])
  )
    return { kind: 'emoji', hexcode: input['hexcode'] };
  throw new Error('Invalid historical template glyph.');
}

function optionalEnum(
  payload: Record<string, unknown>,
  input: Record<string, unknown>,
  key: string,
  values: readonly string[],
): void {
  const value = input[key];
  if (value === undefined) return;
  if (typeof value !== 'string' || !values.includes(value))
    throw new Error('Invalid historical template option.');
  payload[key] = value;
}

function parsePayload(value: unknown): HistoricalTemplatePayload {
  const input = object(value);
  const kind = input['targetType'];
  if (kind !== 'task' && kind !== 'project' && kind !== 'program' && kind !== 'initiative')
    throw new Error('Invalid historical template kind.');
  const result: Record<string, unknown> = { targetType: kind };
  for (const key of TEXT_FIELDS[kind]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new Error('Invalid historical template field.');
    result[key] = input[key];
  }
  parseKindFields(kind, result, input);
  return result as HistoricalTemplatePayload;
}

function parseKindFields(
  kind: HistoricalTemplatePayload['targetType'],
  result: Record<string, unknown>,
  input: Record<string, unknown>,
): void {
  if (kind === 'task') {
    optionalEnum(result, input, 'priority', ['none', 'urgent', 'high', 'medium', 'low']);
    const labels = input['labelIds'];
    if (labels !== undefined) {
      if (
        !Array.isArray(labels) ||
        !labels.every(
          (id: unknown) => typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id),
        )
      )
        throw new Error('Invalid historical template labels.');
      result['labelIds'] = labels.map((id: unknown) => String(id));
    }
    return;
  }
  optionalEnum(result, input, 'health', ['on_track', 'at_risk', 'off_track']);
  if (kind === 'program') optionalEnum(result, input, 'visibility', ['public', 'private']);
  if (kind === 'initiative') {
    optionalEnum(result, input, 'priority', ['none', 'low', 'medium', 'high']);
    optionalEnum(result, input, 'updateCadence', [
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'none',
    ]);
  }
  if (typeof result['summary'] === 'string' && result['summary'].length > 280)
    throw new Error('Historical template summary is too long.');
  if (result['status'] === '') throw new Error('Invalid historical template status.');
}

/** Parse only the0151 definition format and preserve its exact old defaults and field filtering. */
export function parseHistoricalTemplateDefinition(value: unknown): HistoricalTemplateDefinition {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) => !['name', 'description', 'icon', 'defaultStatusKey', 'payload'].includes(key),
    )
  )
    throw new Error('Invalid historical template definition field.');
  if (typeof input['name'] !== 'string' || input['name'].trim().length === 0)
    throw new Error('Name the historical template.');
  const defaultStatusKey = nullableText(input['defaultStatusKey']);
  if (defaultStatusKey === '') throw new Error('Invalid historical default status.');
  return {
    name: input['name'],
    description: nullableText(input['description']),
    icon: glyph(input['icon']),
    defaultStatusKey,
    payload: parsePayload(input['payload']),
  };
}
