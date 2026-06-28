/**
 * Moment route serializers.
 *
 * @packageDocumentation
 */

import type { Moment } from '@athena/types/openapi/moments';
import type { moments } from '../../db/schema/index.js';

type MomentRow = typeof moments.$inferSelect;

export const toMoment = (moment: MomentRow): Moment => ({
  id: moment.id,
  label: moment.label ?? null,
  description: moment.description ?? null,
  startTime: moment.startTime,
  endTime: moment.endTime,
  ownerId: moment.ownerId,
  createdAt: moment.createdAt,
  updatedAt: moment.updatedAt,
});
