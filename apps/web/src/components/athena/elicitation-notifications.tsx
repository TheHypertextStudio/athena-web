'use client';

/**
 * The in-conversation prompt asking to turn web notifications on.
 *
 * @remarks
 * Athena should encourage notifications, and the honest place to do that is the first moment they
 * would have mattered — beside a time-sensitive question, where the cost of not having them is
 * visible — rather than as a modal on first login when the person has no idea what they are for.
 *
 * The rules this component exists to obey, all of which are easy to get wrong:
 *
 * - It appears **only** when the browser can actually deliver (`Notification` + a service worker +
 *   a configured application server key) and permission has not been granted. Offering a control
 *   that cannot work is worse than offering nothing.
 * - Dismissing it is durable. `localStorage` remembers, so it does not reappear on every turn.
 * - Granting removes it permanently, because the subscription is registered server-side and the
 *   query that gates this component then reports the caller as subscribed.
 * - Denying removes it too: the browser will not ask again, so an enable button that can no longer
 *   raise a prompt would be a lie.
 */
import { Bell, BellOff } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, ControlGroup, Text } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { useApiQuery } from '@/lib/query';

import { useRegisterWebPush, webPushConfigDef, webPushSubscriptionDef } from './elicitation-data';

/** Where a dismissal is remembered. */
export const NOTIFICATION_PROMPT_DISMISSED_KEY = 'docket.notifications.promptDismissed';

/** Props for {@link EnableNotificationsPrompt}. */
export interface EnableNotificationsPromptProps {
  /**
   * Whether the moment is right to ask.
   *
   * @remarks
   * The caller passes true when there is a time-sensitive question on screen. The prompt is
   * deliberately not shown on an idle surface: "we would have told you about this one" is the
   * argument, and it only exists when there is a *this one*.
   */
  readonly relevant: boolean;
  /** Extra class names for the root element. */
  readonly className?: string;
}

/** Convert a base64url VAPID key into the buffer `PushManager.subscribe` wants. */
function applicationServerKey(base64Url: string): ArrayBuffer {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

/**
 * Read the current notification permission without prompting.
 *
 * @remarks
 * The Permissions API is asked first and `Notification.permission` is the fallback, not the other
 * way round. Two reasons, and only one of them is about tests: the Permissions API is the standard
 * live-updating source (a person flipping the site setting in another tab is reflected without a
 * reload), and `Notification.permission` reports a flat `denied` in environments where the
 * Notification constructor is stubbed — which would make the enable control invisible on a browser
 * that would in fact have shown it.
 *
 * @returns The permission state, or `'unsupported'` when the browser has no Notification API.
 */
async function readNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const status = await navigator.permissions.query({
      name: 'notifications',
    });
    if (status.state === 'prompt') return 'default';
    return status.state === 'granted' ? 'granted' : 'denied';
  } catch {
    return Notification.permission;
  }
}

/** Ask for web-notification permission at the moment it would first have helped. */
export function EnableNotificationsPrompt({
  relevant,
  className,
}: EnableNotificationsPromptProps): JSX.Element | null {
  const config = useApiQuery(webPushConfigDef());
  const subscription = useApiQuery(webPushSubscriptionDef());
  const register = useRegisterWebPush();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [dismissed, setDismissed] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // Read after mount, never in the state initializer: this component is server-rendered, and React
  // does not patch a hydration attribute mismatch — the server's markup would stick forever.
  useEffect(() => {
    let cancelled = false;
    void readNotificationPermission().then((state) => {
      if (!cancelled) setPermission(state);
    });
    setDismissed(window.localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === '1');
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async (): Promise<void> => {
    setFailure(null);
    const publicKey = config.data?.publicKey;
    if (!publicKey) {
      setFailure('Notifications are not available on this deployment yet.');
      return;
    }
    try {
      // Already-granted permission does not re-prompt, so this is safe to call unconditionally and
      // it is what turns a "granted in the browser, not yet on in Docket" state into a subscription.
      const granted = await Notification.requestPermission().catch(() =>
        readNotificationPermission(),
      );
      setPermission(granted === 'unsupported' ? 'unsupported' : granted);
      if (granted !== 'granted') return;
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const created =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      await register.mutateAsync(created.toJSON());
    } catch {
      // Application-owned copy: the browser's own exception text never reaches the screen.
      setFailure('Your browser would not turn notifications on. Check its site settings.');
    }
  }, [config.data?.publicKey, register]);

  const unavailable =
    permission === 'unsupported' ||
    !config.data?.publicKey ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator);

  if (unavailable) return null;
  if (permission === 'granted' && subscription.data?.subscribed) return null;
  if (permission === 'denied') return null;
  if (dismissed || !relevant) return null;

  return (
    <aside
      data-notification-prompt
      className={cn(
        'bg-secondary-container text-on-secondary-container flex flex-col gap-3 rounded-xl px-4 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <Text token="title-small">Let me reach you when work stops</Text>
          <Text token="body-medium">
            Turn on notifications and I can put a time-sensitive question in front of you with its
            answers as buttons — you can decide without coming back here to find it.
          </Text>
        </div>
      </div>
      {failure ? (
        <Text token="body-small" tone="error" role="alert">
          {failure}
        </Text>
      ) : null}
      <ControlGroup controlSize="lg" wrap>
        <Button
          type="button"
          disabled={register.isPending}
          onClick={() => {
            void enable();
          }}
        >
          <Bell aria-hidden="true" />
          {register.isPending ? 'Turning on…' : 'Turn on notifications'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            window.localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          <BellOff aria-hidden="true" />
          Not now
        </Button>
      </ControlGroup>
    </aside>
  );
}
