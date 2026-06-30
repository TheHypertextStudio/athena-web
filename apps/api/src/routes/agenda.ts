/** `@docket/api` — combined agenda router (mounted at `/v1/agenda`). */
import { AgendaOut } from '@docket/types';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

import { buildAgendaPayload, requireUserId } from './calendar-shared';

function splitIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Combined agenda: Docket timeboxes plus selected Google Calendar events. */
const agenda = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Agenda',
    summary: 'Get combined agenda',
    response: AgendaOut,
    description:
      'Return the signed-in user day agenda with Docket daily-plan timeboxes and selected first-party Google Calendar events. `calendarIds` and `connectionIds` are comma-separated temporary filters for this read.',
  }),
  async (c) => {
    const userId = requireUserId(c);
    const date = c.req.query('date');
    if (!date) throw new ValidationError([{ path: ['date'], message: 'date query is required' }]);
    const includeGoogleCalendar = c.req.query('includeGoogleCalendar');
    const payload = await buildAgendaPayload(userId, {
      date,
      includeGoogleCalendar:
        includeGoogleCalendar === undefined ? undefined : includeGoogleCalendar !== 'false',
      calendarIds: splitIds(c.req.query('calendarIds')),
      connectionIds: splitIds(c.req.query('connectionIds')),
    });
    return ok(c, AgendaOut, payload);
  },
);

export default agenda;
