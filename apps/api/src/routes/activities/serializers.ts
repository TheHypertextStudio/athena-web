/**
 * Activity route serializers.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import type {
  Activity,
  ActivityStream,
  ActivityStreamWithActivities,
  ActivityWithStream,
} from '@athena/types/openapi/activities';
import type { activities, activityStreams } from '../../db/schema/index.js';

type ActivityRow = typeof activities.$inferSelect;
type ActivityStreamRow = typeof activityStreams.$inferSelect;
type ActivityStreamWithActivitiesRow = ActivityStreamRow & { activities: ActivityRow[] };
type ActivityRowWithStream = ActivityRow & { stream?: ActivityStreamRow | null };

const metadataSchema = z.record(z.string(), z.unknown());

function normalizeMetadata(value: unknown): Activity['metadata'] {
  const parsed = metadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toActivity(activity: ActivityRow): Activity {
  return {
    id: activity.id,
    streamId: activity.streamId,
    type: activity.type,
    startTime: activity.startTime,
    endTime: activity.endTime,
    metadata: normalizeMetadata(activity.metadata),
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

export function toActivityStream(stream: ActivityStreamRow): ActivityStream {
  return {
    id: stream.id,
    name: stream.name,
    source: stream.source,
    ownerId: stream.ownerId,
    createdAt: stream.createdAt,
    updatedAt: stream.updatedAt,
  };
}

export function toActivityStreamWithActivities(
  stream: ActivityStreamWithActivitiesRow,
): ActivityStreamWithActivities {
  return {
    ...toActivityStream(stream),
    activities: stream.activities.map(toActivity),
  };
}

export function toActivityWithStream(activity: ActivityRowWithStream): ActivityWithStream {
  return {
    ...toActivity(activity),
    stream: activity.stream ? toActivityStream(activity.stream) : undefined,
  };
}
