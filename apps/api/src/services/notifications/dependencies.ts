import { db } from '@docket/db';

import { createNotificationInboxUseCases, type NotificationInboxUseCases } from './inbox';
import {
  createNotificationIntentUseCases,
  type NotificationIntentUseCases,
} from './intent-use-cases';

/** Dependencies needed by notification HTTP route factories. */
export interface NotificationRouteDependencies {
  /** Signed-in user inbox use cases. */
  readonly inbox: NotificationInboxUseCases;
  /** Staff notification intent use cases. */
  readonly intents: NotificationIntentUseCases;
}

/** Build the production notification route dependencies. */
export function createNotificationRouteDependencies(): NotificationRouteDependencies {
  return {
    inbox: createNotificationInboxUseCases(db),
    intents: createNotificationIntentUseCases(db),
  };
}
