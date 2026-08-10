/** Window behavior for entering and leaving immersive Focus mode. */
import { sameOriginPath } from '@/lib/same-origin-path';

/** The small pop-out shape launch needs. */
export interface FocusPopup {
  readonly focus: () => void;
}

/** Dependencies for {@link launchFocusMode}. */
export interface LaunchFocusModeOptions {
  readonly open: (url: string, target: string, features: string) => FocusPopup | null;
  readonly navigate: (href: string) => void;
  readonly mobile: boolean;
  /** The application route Focus should return to. */
  readonly returnPath: string;
}

/** Build one Focus URL carrying only the launch route needed for a safe return. */
function focusHref(returnPath: string, popout: boolean): string {
  const query = new URLSearchParams({
    ...(popout ? { mode: 'popout' } : {}),
    returnTo: returnPath,
  });
  return `/focus?${query.toString()}`;
}

/**
 * Prefer a stable named Focus pop-out, with a same-tab fallback.
 *
 * @param options - Browser operations injected for deterministic behavior and tests.
 * @returns Which entry mode succeeded.
 */
export function launchFocusMode(options: LaunchFocusModeOptions): 'popout' | 'same-tab' {
  if (!options.mobile) {
    const popup = options.open(
      focusHref(options.returnPath, true),
      'docket-focus',
      'popup=yes,width=1180,height=780,resizable=yes,scrollbars=yes,noopener=no,noreferrer=no',
    );
    if (popup) {
      popup.focus();
      return 'popout';
    }
  }
  options.navigate(focusHref(options.returnPath, false));
  return 'same-tab';
}

/** The launcher window shape immersive Focus may return to. */
export interface FocusOpener {
  readonly closed: boolean;
  readonly focus: () => void;
}

/** Dependencies for {@link returnFromFocus}. */
export interface ReturnFromFocusOptions {
  readonly popout: boolean;
  readonly opener: FocusOpener | null;
  readonly close: () => void;
  readonly navigate: (href: string) => void;
  /** Untrusted query value naming the route that launched Focus. */
  readonly returnPath: string | null;
  /** Current application origin used to reject an external return path. */
  readonly origin: string;
}

/** Return to the launching workspace, or to the nearest truthful in-tab fallback. */
export function returnFromFocus(options: ReturnFromFocusOptions): void {
  if (options.popout && options.opener && !options.opener.closed) {
    options.opener.focus();
    options.close();
    return;
  }
  if (!options.popout) {
    options.navigate(sameOriginPath(options.returnPath, options.origin) ?? '/today');
    return;
  }
  options.navigate('/today');
}
