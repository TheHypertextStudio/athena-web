import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';

export interface SessionSubscriptions {
  uris: Set<string>;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
}

export const getSessionKey = (
  extra: { sessionId?: string; requestId: string | number } | undefined,
): string | null => {
  if (!extra) {
    return null;
  }
  if (extra.sessionId) {
    return extra.sessionId;
  }
  return `request-${String(extra.requestId)}`;
};

export const getSessionSubscriptions = (
  subscriptions: Map<string, SessionSubscriptions>,
  sessionKey: string,
): SessionSubscriptions => {
  const existing = subscriptions.get(sessionKey);
  if (existing) {
    return existing;
  }
  const entry: SessionSubscriptions = { uris: new Set<string>() };
  subscriptions.set(sessionKey, entry);
  return entry;
};

const isResourceSubscribed = (subscriptions: Set<string>, uri: string): boolean => {
  for (const subscription of subscriptions) {
    if (uri === subscription || uri.startsWith(`${subscription}/`)) {
      return true;
    }
  }
  return false;
};

export const sendResourceUpdates = async (
  uris: string[],
  subscriptions: Map<string, SessionSubscriptions>,
) => {
  if (subscriptions.size === 0) {
    return;
  }
  const uniqueUris = Array.from(new Set(uris));
  const notifications: Promise<void>[] = [];
  for (const session of subscriptions.values()) {
    if (!session.sendNotification || session.uris.size === 0) {
      continue;
    }
    const matches = uniqueUris.filter((uri) => isResourceSubscribed(session.uris, uri));
    for (const uri of matches) {
      notifications.push(
        session.sendNotification({
          method: 'notifications/resources/updated',
          params: { uri },
        } as ServerNotification),
      );
    }
  }
  if (notifications.length === 0) {
    return;
  }
  await Promise.all(notifications);
};
