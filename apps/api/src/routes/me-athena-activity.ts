/** Owner-safe projection for activity returned by the personal Athena API. */
import type { SessionActivityOut } from '@docket/types';
import type { z } from 'zod';

import { toActivityOut, type ActivityRow } from './agent-session-helpers';

const FAILURE_COPY = 'Athena could not complete this step.';
const FAILED_ACTION_COPY = 'This action could not be completed.';
const MAX_TEXT = 1_000;
const MAX_VALUE_TEXT = 512;
const MAX_KEYS = 20;
const MAX_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_TECHNICAL_BYTES = 4_096;
const SECRET_KEY = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~-]+|\bsk-[a-z0-9_-]{8,})/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback: string, limit = MAX_TEXT): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;
}

/** Recursively retain bounded diagnostic primitives while redacting secret-like fields. */
function technicalValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return SECRET_VALUE.test(value) ? '[redacted]' : value.slice(0, MAX_VALUE_TEXT);
  }
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => technicalValue(item, depth + 1));
  }
  const source = record(value);
  if (!source) return typeof value === 'bigint' ? value.toString() : '[unsupported]';
  return Object.fromEntries(
    Object.entries(source)
      .slice(0, MAX_KEYS)
      .map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[redacted]' : technicalValue(item, depth + 1),
      ]),
  );
}

function boundedTechnicalValue(value: unknown): unknown {
  const sanitized = technicalValue(value);
  return JSON.stringify(sanitized).length <= MAX_TECHNICAL_BYTES
    ? sanitized
    : { notice: 'Technical input omitted because it was too large.' };
}

function personalBody(activity: ActivityRow): Record<string, unknown> {
  if (activity.type === 'error') return { text: FAILURE_COPY };
  if (activity.type === 'response') {
    return {
      text: text(activity.body.text, 'Athena updated this work.'),
      ...(activity.body.author === 'user' ? { author: 'user' } : {}),
    };
  }
  if (activity.type === 'elicitation') {
    const options = Array.isArray(activity.body['options'])
      ? activity.body['options']
          .slice(0, MAX_ITEMS)
          .map(record)
          .filter((option): option is Record<string, unknown> => option !== null)
          .map((option) => ({
            id: text(option['id'], '', 120),
            label: text(option['label'], '', 240),
          }))
          .filter((option) => option.id.length > 0 && option.label.length > 0)
      : [];
    return {
      text: text(activity.body.text, 'Athena needs your answer.'),
      ...(options.length > 0 ? { options } : {}),
    };
  }
  if (activity.type === 'action') {
    const action = record(activity.body.action) ?? {};
    const summary = text(action['summary'], 'Update your work', 240);
    const toolCall = record(action['toolCall']);
    const result = record(action['result']);
    const isError = result?.['isError'] === true;
    return {
      action: {
        ...(typeof action['kind'] === 'string' ? { kind: action['kind'].slice(0, 120) } : {}),
        summary,
        ...(toolCall
          ? {
              toolCall: {
                ...(typeof toolCall['connection'] === 'string'
                  ? { connection: toolCall['connection'].slice(0, 120) }
                  : {}),
                ...(typeof toolCall['tool'] === 'string'
                  ? { tool: toolCall['tool'].slice(0, 160) }
                  : {}),
                ...(toolCall['input'] === undefined
                  ? {}
                  : { input: boundedTechnicalValue(toolCall['input']) }),
              },
            }
          : {}),
        ...(result
          ? {
              result: {
                content: isError ? FAILED_ACTION_COPY : `Completed: ${summary}`,
                isError,
              },
            }
          : {}),
      },
    };
  }
  return {};
}

/** Convert one persisted row to the allowlisted personal activity contract. */
export function toPersonalActivityOut(activity: ActivityRow): z.input<typeof SessionActivityOut> {
  return { ...toActivityOut(activity), body: personalBody(activity) };
}
